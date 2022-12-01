import {Chain, PoolInfo, PrimedPoolFile, TokenInfo} from "./index";
import {
    allowed, disallowed,
    EXCHANGES,
    IERC20_ABI,
    PANCAKE_ROUTER_ADDRESS,
    ROUTERS,
    UNISWAP_PAIR,
    WBNB, web3
} from "./constants";
import fs from "fs";
import cliProgress from "cli-progress";
import sha1 from "sha1";
import {BigNumber} from "bignumber.js";

import {IPancakeERC20} from "../typechain/IPancakeERC20";
import {PancakePair} from "../typechain/PancakePair";
import {PancakeERC20} from "../typechain/PancakeERC20";

import Web3 from "web3";
import colors from "colors";
import {BlockType} from "../typechain/types";

export let blockType: BlockType = 'latest';

export function setBlockType(type: BlockType) {
    blockType = type;
}

export const tokenInfo: {
    [tokenAddress: string]: TokenInfo
} = {};
// pool hash of sha512((token0,token1).sort()+router_address)
export const poolInfoMap: {
    [poolHash: string]: PoolInfo
} = {}
export const poolIndexByToken: {
    [tokenAddress: string]: { [oppositeToken: string]: {[poolAddress: string]: PoolInfo} }
} = {}
export const poolIndexByAddress: {
    [poolAddress: string]: PoolInfo
} = {}
export const bnbPoolIndex: {
    [tokenAddress: string]: PoolInfo
} = {}
export const triangularIndex: {
    [pool: string]:  Chain[]
} = {}
export var nextBlockEst = -1;

export function setNextBlockEst(time: number){
    nextBlockEst = time;
}


function indexPool(pool: PoolInfo) {
    poolInfoMap[pool.hashCode] = pool

    if (disallowed.has(pool.token0) || disallowed.has(pool.token1)) {
        poolInfoMap[pool.hashCode] = {valid: false} as PoolInfo
        poolInfoMap[pool.hashCode] = {valid: false} as PoolInfo
        return;
    }

    if (!poolIndexByToken[pool.token0]) {
        poolIndexByToken[pool.token0] = {}
    }
    if (!poolIndexByToken[pool.token1]) {
        poolIndexByToken[pool.token1] = {}
    }

    if (!poolIndexByToken[pool.token0][pool.token1]) {
        poolIndexByToken[pool.token0][pool.token1] = {}
    }
    if (!poolIndexByToken[pool.token1][pool.token0]) {
        poolIndexByToken[pool.token1][pool.token0] = {}
    }
    // add to index
    if (!poolIndexByToken[pool.token0][pool.token1][pool.contractAddress.toLowerCase()]) {
        poolIndexByToken[pool.token0][pool.token1][pool.contractAddress.toLowerCase()] = pool
    }
    if (!poolIndexByToken[pool.token1][pool.token0][pool.contractAddress.toLowerCase()]) {
        poolIndexByToken[pool.token1][pool.token0][pool.contractAddress.toLowerCase()] = pool
    }

    poolIndexByAddress[pool.contractAddress.toLowerCase()] = pool

    // create WBNB index of token.address -> WBNB pool
    if (pool.token0 === WBNB) {
        bnbPoolIndex[pool.token1] = pool
    } else if (pool.token1 === WBNB) {
        bnbPoolIndex[pool.token0] = pool
    }
}

function buildTriIndex(pool: PoolInfo) {
    // create an index for triangular chains
    triangularIndex[pool.hashCode] = getChains(pool)
}

export function getChains(pool: PoolInfo): Chain[] {
    const chains = [];
    const token0 = tokenInfo[pool.token0];
    const token1 = tokenInfo[pool.token1];
    // O(1) -- just loop 2x
    for (const [startToken, token2] of [[token0, token1], [token1, token0]]) {

        // O(N) -- loop per pair this token is in
        for (const [token3Address, newPools] of Object.entries(poolIndexByToken[token2.address])) {
            if (!poolIndexByToken[token3Address][startToken.address] || token3Address === startToken.address) {
                continue;
            }
            // O(M) -- loop per exchange (M=2)
            for (const [address, pool2] of Object.entries(newPools)) {
                if (pool2.contract.options.address === pool.contract.options.address) {
                    continue;
                }
                //await updatePool(pool2);
                const token3 = tokenInfo[token3Address];


                // O(M) -- loop per exchange (M=2)
                for (const [address, pool3] of Object.entries(poolIndexByToken[token3.address][startToken.address])) {
                    chains.push({
                        pools: [pool.contractAddress, pool2.contractAddress, pool3.contractAddress],
                        tokens: [startToken.address, token2.address, token3.address]
                    })
                }

            }
        }
    }
    return chains;
}

export async function primePools() {
    // check if we have a pools file
    // if not go to each factory and loop through pools
    // build poolInfoMap and write that to disk
    const primedPools = 'primedPools.json'
    if (fs.existsSync(primedPools)) {
        // read and just update
        const pools = JSON.parse(fs.readFileSync(primedPools, 'utf8')) as PrimedPoolFile
        for (const token of pools.tokens) {
            tokenInfo[token.address] = token;
        }
        const loadPairsBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        loadPairsBar.start(pools.pools.length, 0)
        let count = 0;
        for (const pool of pools.pools) {
            if (pool.valid) {
                pool.contractAddress = pool.contractAddress.toLowerCase();
                pool.contract = getPair(pool.contractAddress);
                indexPool(pool)
                // since we update all we dont need to worry
                //promises.push(updatePool(pool as PoolInfo))
                count++
                loadPairsBar.update(count)
            }
        }
    } else {
        let promises = []
        const loadPairsBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        loadPairsBar.start(allowed.size**2, 0)
        for (const [token1, allow] of allowed) {
            if(!allow) continue;
            for (const [token2, allow2] of allowed) {
                if(!allow || !allow2) continue;
                for(const [router, factory] of Object.entries(ROUTERS)){
                    promises.push(factory.methods.getPair(token1, token2).call().then(pool => {
                        return validatePool(pool, router);
                    }).catch(e => {}))
                }
                if(promises.length % 2000 === 0){
                    await Promise.all(
                        promises
                    )
                    promises = [];
                    writeToDisk();
                }
                loadPairsBar.increment();
            }

        }
        await Promise.all(promises);
        writeToDisk();
        const pools = Object.entries(poolInfoMap);
        loadPairsBar.start(pools.length, 0)
        for (const [hash, pool] of pools) {
            buildTriIndex(pool);
            loadPairsBar.increment()
        }
    }
    process.on('SIGINT', () => {
        console.log('Do something useful here.');
        writeToDisk();
        process.exit();
    });
    process.on('beforeExit', () => {
        console.log('Do something useful here.');
        writeToDisk();
        process.exit();
    });
}

export function writeToDisk() {
    const primedPools = 'primedPools.json'
    // now write it to disk
    const poolData: PrimedPoolFile = {
        pools: [],
        tokens: []
    }
    poolData.pools = Object.values(poolInfoMap).filter(pool => pool.valid).map(pool => {
        const {contract, ...cleanPool} = pool as PoolInfo;
        return cleanPool as PoolInfo
    })
    poolData.tokens = Object.values(tokenInfo);
    fs.writeFileSync(primedPools, JSON.stringify(poolData));
}

export async function setPoolInfo(input_token_address: string, out_token_address: string) {
    //out token balance
    const pools: string[][] = [];
    for (const [router, factory] of Object.entries(ROUTERS)) {
        const pool_address = await factory.methods.getPair(input_token_address, out_token_address).call();
        if (pool_address == '0x0000000000000000000000000000000000000000') {
            poolInfoMap[sha1([input_token_address, out_token_address].sort() + router) as string] = {valid: false} as PoolInfo
        }
        pools.push([pool_address, router])
    }

    for (const pool of pools) {
        const pool_address = pool[0];
        const router_address = pool[1];
        // if we already have it just leave, we will catch it during update
        if (poolInfoMap[sha1([input_token_address, out_token_address].sort() + router_address) as string]) return;
        await validatePool(pool_address, router_address);
    }

}

export async function validatePool(pool_address: string, router_address: string) {

    const pool_contract = getPair(pool_address);
    const reserves = await pool_contract.methods.getReserves().call(undefined, blockType);

    const token0_address = (await pool_contract.methods.token0().call()).toLowerCase();
    const token1_address = (await pool_contract.methods.token1().call()).toLowerCase();

    if (disallowed.has(token0_address) || disallowed.has(token1_address)) {
        for (const [router] of Object.entries(ROUTERS)) {
            poolInfoMap[sha1([token0_address, token1_address].sort() + router) as string] = {valid: false} as PoolInfo
        }
        return;
    }

    await setTokenInfo(token0_address, token1_address);

    const poolInfo: PoolInfo = {
        hashCode: sha1([token0_address, token1_address].sort() + router_address) as string,
        valid: true,
        contract: pool_contract,
        contractAddress: pool_contract.options.address.toLowerCase(),
        reserve0: new BigNumber(reserves._reserve0),
        reserve1: new BigNumber(reserves._reserve1),
        token0: token0_address,
        token1: token1_address,
        fee: getFee(router_address),
        exchange: EXCHANGES[router_address] || ''
    };

    indexPool(poolInfo);
}

async function setTokenInfo(input_token_address: string, out_token_address: string) {
    if (!tokenInfo[out_token_address]) {
        const outTokenContract = (new web3.eth.Contract(IERC20_ABI.abi, out_token_address) as any) as PancakeERC20;
        tokenInfo[out_token_address] = {
            symbol: await outTokenContract.methods.symbol().call(),
            decimals: new BigNumber(10).pow(await outTokenContract.methods.decimals().call()),
            address: out_token_address
        }
    }
    if (!tokenInfo[out_token_address] || !tokenInfo[out_token_address].symbol) {
        let log_str = `Invalid Token at: ${out_token_address}`
        console.log(colors.red(log_str))
        return;
    }
    if (!tokenInfo[input_token_address]) {
        const inTokenContract = (new web3.eth.Contract(IERC20_ABI.abi, input_token_address) as any) as IPancakeERC20;
        tokenInfo[input_token_address] = {
            symbol: await inTokenContract.methods.symbol().call(),
            decimals: new BigNumber(10).pow(await inTokenContract.methods.decimals().call()),
            address: input_token_address
        }
    }
    if (!tokenInfo[input_token_address] || !tokenInfo[input_token_address].symbol) {
        let log_str = `Invalid Token at: ${input_token_address}`
        console.log(colors.red(log_str))
        return;
    }
}

function getPair(pool_address: string): PancakePair {
    return (new web3.eth.Contract(UNISWAP_PAIR.abi, pool_address) as any) as PancakePair;
}

// update a pool with the latest actual block prices
export async function updatePool(pool: PoolInfo) {
    const reserves = await (pool as PoolInfo).contract.methods.getReserves().call(undefined, blockType);
    pool.reserve0 = new BigNumber(reserves._reserve0);
    pool.reserve1 = new BigNumber(reserves._reserve1);
}

function getFee(router_address: string): number {
    if (router_address === PANCAKE_ROUTER_ADDRESS) {
        return 2
    } else {
        return 3;
    }
}


