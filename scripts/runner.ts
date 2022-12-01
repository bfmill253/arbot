import Web3 from "web3";
import {Chain, DecodedFunction, PoolInfo, TokenInfo} from "./index";
import {
    BISWAP_ROUTER,
    estGasCost, flashBot,
    FLASHBOT_ADDRESS, flashCalc, overRideWeb3,
    PANCAKE_ROUTER,
    PANCAKE_ROUTER_ADDRESS, ROUTER_LIQUIDITY_METHODS,
    ROUTER_LIST, ROUTER_SWAP_METHODS, userWallet, WBNB,
    WBNB_DECIMALS, web3,
    web3 as constWeb
} from "./constants";

const colors = require('colors');
import sha1 from "sha1";

const abiDecoder = require('abi-decoder');
abiDecoder.addABI(PANCAKE_ROUTER.abi);
abiDecoder.addABI(BISWAP_ROUTER.abi);
import {BigNumber} from "bignumber.js"
import {Transaction} from "web3/eth/types";
import {
    blockType,
    bnbPoolIndex, getChains, nextBlockEst,
    poolIndexByAddress,
    poolIndexByToken,
    poolInfoMap, setPoolInfo,
    tokenInfo, triangularIndex, updatePool,
    validatePool,
    writeToDisk
} from "./store";
import {delay} from "@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService";


let isRunning = false;

export async function handleNewBlock(blockNumber: number) {
    const block = await web3.eth.getBlock(blockNumber, true)
    if (!block || !block.transactions) return;
    const poolsToUpdate = new Map<string, { in_token: string, out_token: string, router: string }>();
    for (const transaction of block.transactions) {
        if (transaction && transaction.to && ROUTER_LIST.includes(transaction.to.toLowerCase())) {
            await handleTransaction(transaction as Transaction, transaction.to.toLowerCase(), poolsToUpdate)
        }
    }
    console.log(`blockTime: ${block.timestamp}, currentTime: ${new Date().getTime()}`)
    handleBlock(poolsToUpdate, blockNumber)
}

export async function handleTransaction(transaction: Transaction, router_address: string, poolsToUpdate: Map<string, { in_token: string, out_token: string, router: string }>) {
    const input = transaction.input;

    const inputData = decode(input);
    if (!inputData) return;
    let path;
    if (ROUTER_SWAP_METHODS.includes(inputData.name)) {
        path = inputData.params.find(param => param.name === 'path')?.value as string[] | null
    } else if (ROUTER_LIQUIDITY_METHODS.includes(inputData.name)) {
        // either params :[token] or params: [tokenA, tokenB]
        const tokenA = inputData.params.find(param => param.name === 'tokenA')?.value as string | null
        const tokenB = inputData.params.find(param => param.name === 'tokenB')?.value as string | null
        const token = inputData.params.find(param => param.name === 'token')?.value as string | null
        if (!tokenA || !tokenB) {
            path = [token as string, WBNB];
        } else {
            path = [tokenA as string, tokenB as string]
        }
    }
    if (path) {
        for (let i = 0; i < path.length - 1; i++) {
            const poolId = sha1([path[i].toLowerCase(), path[i + 1].toLowerCase()].sort() + router_address) as string
            poolsToUpdate.set(poolId, {
                in_token: path[i].toLowerCase(),
                out_token: path[i + 1].toLowerCase(),
                router: router_address
            })
        }
    }
}

export async function handleBlock(poolsToUpdate: Map<string, { in_token: string, out_token: string, router: string }>, blockNumber: number | string) {
    const chains: Chain[] = [];
    const start = Date.now();
    let count = 0
    for (let [key, value] of poolsToUpdate) {
        const pool = poolInfoMap[key];
        if (!pool) {
            await setPoolInfo(value.in_token, value.out_token)
            count++;
        }
    }

    const set = Date.now();
    // our pools were updated, look for an arb opp in the tokens that were updated

    /**
     * 1. for the updated pools look at other token chains and run a triangular arb play
     */
    // O(N) -- loop per pair in this block
    for (let key of poolsToUpdate.keys()) {
        const pool = poolInfoMap[key];
        if (!pool || !pool.valid) continue;
        chains.push(...getChains(pool))
    }

    const foundChains = Date.now();
    if (chains.length <= 0) return;

    const updatedPools = Date.now();
    const promises = [];
    for (let chain of chains) {
        promises.push(callArbContract(
            chain.pools,
            chain.tokens,
            blockNumber
        ))
    }
    await Promise.all(promises);
    const end = Date.now();
    console.log(colors.white([
        `block: ${blockNumber}`,
        `newPools:     ${count}  time ${set - start}ms`,
        `foundChains:  ${chains.length}  time ${foundChains - set}ms,   total: ${foundChains - start}ms`,
        `looking:         time ${end - updatedPools}ms,   total: ${end - start}ms`,
    ].join('\n')))
}

export async function callArbContract(pools: string[], tokens: string[], time: number | string) {
    let amount: BigNumber;
    let profit: BigNumber;
    try {
        const response = await flashCalc.methods.calculate([tokens[0], tokens[1], tokens[2], pools[0], pools[1], pools[2]])
            .call({from: '0xf3455544aE972348D1703e4B27B03625A57F8712'}, blockType);
        amount = new BigNumber(response.optimalIn)
        profit = new BigNumber(response.profit);
        const index = new BigNumber(response.arbIndex);
        if(profit.minus(estGasCost).lt(0)){
            // no op
            return;
        }
        printOpp(
            tokens,
            pools,
            index,
            amount,
            profit,
            time
        )
    } catch (e) {
        // errors if no trade is avail
        return
    }
    if(isRunning) return;

    isRunning = true;
    writeToDisk();
    if ((typeof time === 'number') && time > 0) {
        const wait = time - Date.now();
        await delay(wait)
    }
    console.log(`Sending transaction at: ${Date.now()}`);
    let est;
    try {
        est = await flashBot.methods.triFlashArb(pools, tokens, amount.toFixed(0)).estimateGas({
            from: '0xf3455544aE972348D1703e4B27B03625A57F8712'
        });
        console.log(colors.red(`Est Gas: ${est}`))
        const tx = await flashBot.methods.triFlashArb(pools, tokens, amount.toFixed(0)).send({
            from: '0xf3455544aE972348D1703e4B27B03625A57F8712',
            gas: 3000000,
            gasPrice: web3.utils.toWei('8', 'gwei'),
        });
        console.log('confirmation : ', tx);
    } catch (e) {
        console.log(colors.red(`Error during run or estimate`));
        console.log(e);
        isRunning = false;
        return;
    }
    return;
}

async function printOpp(
    tokens: string[],
    pools: string[],
    arbIndex: BigNumber,
    optimalIn: BigNumber,
    profitEst: BigNumber,
    blockNumber: string | number
) {
    const startToken = tokenInfo[tokens[0]];
    const token2 = tokenInfo[tokens[1]];
    const token3 = tokenInfo[tokens[2]];
    const pool = poolIndexByAddress[pools[0]];
    const pool2 = poolIndexByAddress[pools[1]];
    const pool3 = poolIndexByAddress[pools[2]];
    const netProfit = profitEst?.minus(estGasCost);
        const log = [
            `Found at:   ${Date.now()}`,
            `Block:      ${blockNumber}`,
            `Index:      ${arbIndex.toFixed(12)}`,
            `OptimalIn:  ${optimalIn.div(startToken.decimals).toFixed(12)} ${startToken.symbol}`,
            `Profit Est: ${profitEst?.div(WBNB_DECIMALS).toFixed(12) || 'No BNB Pool found'} BNB`,
            `Net Profit: ${netProfit?.div(WBNB_DECIMALS).toFixed(12) || 'No BNB Pool found'} BNB`,

            `${startToken.symbol}/${token2.symbol}(${pool.exchange}: ${pool.contract.options.address})`,
            `token0: ${tokenInfo[pool.token0].symbol} token1: ${tokenInfo[pool.token1].symbol} ->`,
            `${token2.symbol}/${token3.symbol}(${pool2.exchange}: ${pool2.contract.options.address})`,
            `token0: ${tokenInfo[pool2.token0].symbol} token1: ${tokenInfo[pool2.token1].symbol} ->`,
            `${token3?.symbol}/${startToken.symbol}(${pool3?.exchange}: ${pool3?.contract.options.address})`,
            `token0: ${tokenInfo[pool3.token0].symbol} token1: ${tokenInfo[pool3.token1].symbol}`
        ].join('\n');
        console.log(colors.green(log))
}

async function calculateProfits(
    blockNumber: number | string,
    startToken: TokenInfo,
    token2: TokenInfo,
    token3: TokenInfo,
    pool: PoolInfo,
    pool2: PoolInfo,
    pool3?: PoolInfo,
): Promise<BigNumber | undefined> {
    // were startToken is the input to 2 of the legs, one is the numerator
    // start Eth (reserve1Eth/reserve0WBTC)/((reserve2Eth/reserve2LINK)*(reserve3LIN/reserve3WBTC)) =
    // where pool.token0 === pool2.token0 && pool2.token1 === pool3.token0 && pool3.token1 === pool.token1
    // numerator is the higher price
    // (pool.reserve0/pool.reserve0)/((pool2.reserve0/pool2.reserve1)*(pool3.reserve0/pool3.reserve1))

    /**
     * for (A -> B)[p1] -> (B -> C)[p2] -> (C -> A)[p3]
     * or a -> b1(B) -> b2(C) -> a
     *
     * r3_1 = final pool fee
     * r3_2 = 1
     * a3 = final pool[p3] "A" token liquidity
     * b1_1 = liquidity of token of pool[p1] that is NOT "A"
     * a1 = liquidity of token of pool[p1] that IS token "A"
     * b1_2 = liquidity of token in pool[p2] that IS token "B"
     * b2_2 = liquidity of the token in pool[p2] that IS token "C"
     * b2_3 = liquidity of the token in pool[p3] that IS token "C"
     *
     * arbIndex = (r3_1*r3_2*a3*b1_1*b2_1)/(a1*b1_2*b3_2) - 1
     * if(arbIndex > 0){
     *     make trade
     * }
     */
    let arbIndex, optimalIn, netProfit;
    const token_a = startToken.address
    const token_b = pool.token0 === startToken.address ? pool.token1 : pool.token0
    const token_c = pool2.token0 === token_b ? pool2.token1 : pool2.token0
    if (pool3) {

        const r3_1 = new BigNumber(1).minus(new BigNumber(pool3.fee).div(1000))
        const r3_2 = new BigNumber(1)
        const a3 = pool3.token0 === token_a ? pool3.reserve0 : pool3.reserve1
        const b1_1 = pool.token0 === token_b ? pool.reserve0 : pool.reserve1
        const a1 = pool.token0 === token_a ? pool.reserve0 : pool.reserve1
        const b1_2 = pool2.token0 === token_b ? pool2.reserve0 : pool2.reserve1
        const b2_2 = pool2.token0 === token_c ? pool2.reserve0 : pool2.reserve1
        const b2_3 = pool3.token0 === token_c ? pool3.reserve0 : pool3.reserve1

        const numerator = r3_1.times(r3_2).times(a3).times(b1_1).times(b2_2);
        const denominator = a1.times(b1_2).times(b2_3);
        arbIndex = numerator.div(denominator)
        arbIndex = arbIndex.minus(1)
    }

    /**
     * for (A -> B)[p1] -> (B -> C)[p2] -> (C -> A)[p3]
     * or a -> b1(B) -> b2(C) -> a
     *
     * r1 = final pool fee
     * r2 = 1
     * a1 = liquidity of token of pool[p1] that IS token "A"
     * b1 = liquidity of token of pool[p1] that is NOT "A"
     * b2 = liquidity of token in pool[p2] that IS token "B"
     * c2 = liquidity of the token in pool[p2] that is NOT token "B"
     * c3 = liquidity of token of pool[p3] that is NOT "A"
     * a3 = liquidity of token of pool[p3] that IS token "A"
     *
     * a_v = (a1 * b1)/(b2 + r1 * r2 * b1)
     * c_v = (r1 * r2 * b1 * c2)/(b2 + r1 * r2 * b1)
     * a = (a_v * c3)/(c3 + r1 * r2 * c_v)
     * a_ = (r1 * r2 * c_v * a3)/(c3 + r1 * r2 * c_v)
     *
     * optimalInputTokenA = (sqrt(r1 * r2 * a_ * a) - a)/r1
     */
    if (pool3 && arbIndex && arbIndex.gt(0)) {
        const r1 = new BigNumber(1).minus(new BigNumber(pool3.fee).div(1000))
        const r2 = new BigNumber(1)
        const a1 = pool.token0 === token_a ? pool.reserve0 : pool.reserve1
        const b1 = pool.token0 === token_b ? pool.reserve0 : pool.reserve1
        const b2 = pool2.token0 === token_b ? pool2.reserve0 : pool2.reserve1
        const c2 = pool2.token0 === token_c ? pool2.reserve0 : pool2.reserve1
        const c3 = pool3.token0 === token_c ? pool3.reserve0 : pool3.reserve1
        const a3 = pool3.token0 === token_a ? pool3.reserve0 : pool3.reserve1

        const a_v = (a1.times(b2)).div(r1.times(r2).times(b1).plus(b2))
        const c_v = (r1.times(r2).times(b1).times(c2)).div(r1.times(r2).times(b1).plus(b2))
        const a = (a_v.times(c3)).div(r1.times(r2).times(c_v).plus(c3))
        const a_ = (r1.times(r2).times(c_v).times(a3)).div((r1.times(r2).times(c_v)).plus(c3))
        optimalIn = ((r1.times(r2).times(a_).times(a)).sqrt().minus(a)).div(r1)
        if (optimalIn.div(startToken.decimals).gt(0)) {
            let amountOut = optimalIn
            amountOut = getAmountOut(amountOut, a1, b1, pool.fee)
            amountOut = getAmountOut(amountOut, b2, c2, pool2.fee)
            amountOut = getAmountOut(amountOut, c3, a3, pool3.fee)
            const profit = amountOut.minus(optimalIn);
            const profitEst = convertToBNB(startToken.address, profit);
            netProfit = profitEst?.minus(estGasCost);
            if (!netProfit) {
                console.log(colors.red(`No WBNB pair for: ${startToken.symbol}`))
            }
            if (netProfit?.gt(0)) {
                const log = [
                    `Found at:   ${Date.now()}`,
                    `Block:      ${blockNumber}`,
                    `Index:      ${arbIndex.toFixed(12)}`,
                    `OptimalIn:  ${optimalIn.div(startToken.decimals).toFixed(12)} ${startToken.symbol}`,
                    `AmountOut:  ${amountOut.div(startToken.decimals).toFixed(12)} ${startToken.symbol}`,
                    `Profit:     ${profit.div(startToken.decimals).toFixed(12)} ${startToken.symbol}`,
                    `Profit Est: ${profitEst?.div(WBNB_DECIMALS).toFixed(12) || 'No BNB Pool found'} BNB`,
                    `Net Profit: ${netProfit?.div(WBNB_DECIMALS).toFixed(12) || 'No BNB Pool found'} BNB`,

                    `${startToken.symbol}/${token2.symbol}(${pool.exchange}: ${pool.contract.options.address})`,
                    `token0: ${pool.reserve0} ${tokenInfo[pool.token0].symbol} token1: ${pool.reserve1} ${tokenInfo[pool.token1].symbol} ->`,
                    `${token2.symbol}/${token3.symbol}(${pool2.exchange}: ${pool2.contract.options.address})`,
                    `token0: ${pool2.reserve0} ${tokenInfo[pool2.token0].symbol} token1: ${pool2.reserve1} ${tokenInfo[pool2.token1].symbol} ->`,
                    `${token3?.symbol}/${startToken.symbol}(${pool3?.exchange}: ${pool3?.contract.options.address})`,
                    `token0: ${pool3.reserve0} ${tokenInfo[pool3.token0].symbol} token1: ${pool3.reserve1} ${tokenInfo[pool3.token1].symbol}`
                ].join('\n');
                console.log(colors.green(log))
            }
        }
    }

    return netProfit?.gt(0) ? optimalIn : undefined;
}

function decode(input: string): DecodedFunction | null {
    const decodedData = abiDecoder.decodeMethod(input);
    if (!decodedData) return null;
    const method = decodedData['name'];
    const params = decodedData['params'];
    return {name: method, params}
}


// get the initial pool info

function convertToBNB(token: string, amount: BigNumber): BigNumber | undefined {
    if (token === WBNB) return amount;

    const pool = bnbPoolIndex[token];
    if (pool) {
        const reserveIn = pool.token0 === token ? pool.reserve0 : pool.reserve1;
        const reserveOut = pool.token0 === token ? pool.reserve1 : pool.reserve0;
        return getAmountOut(amount, reserveIn, reserveOut, pool.fee)
    }
}

// Same as calling this on the node
// Pancake fee === 2
// Biswap fee === (pair based fee)
function getAmountOut(amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber, swapFee: number): BigNumber {
    const multiple = new BigNumber(1000);
    const amountInWithFee = amountIn.times(multiple.minus(swapFee));
    const numerator = amountInWithFee.times(reserveOut);
    const denominator = reserveIn.times(multiple).plus(amountInWithFee);
    return numerator.div(denominator);
}

// given some amount of an asset and pair reserves, returns an equivalent amount of the other asset
function quote(amountA: BigNumber, reserveA: BigNumber, reserveB: BigNumber): BigNumber {
    return amountA.times(reserveB).div(reserveA);
}

export async function calcAmountIn(web3: Web3, pools: string[], tokens: string[]): Promise<BigNumber | undefined> {
    overRideWeb3(web3);
    for (const pool of pools) {
        await validatePool(pool.toLowerCase(), PANCAKE_ROUTER_ADDRESS)
    }
    return calculateProfits(
        0,
        tokenInfo[tokens[0].toLowerCase()],
        tokenInfo[tokens[1].toLowerCase()],
        tokenInfo[tokens[2].toLowerCase()],
        poolIndexByAddress[pools[0].toLowerCase()],
        poolIndexByAddress[pools[1].toLowerCase()],
        poolIndexByAddress[pools[2].toLowerCase()]
    )
}


export async function handlePendingTransaction(txHash: string) {
    const transaction = await web3.eth.getTransaction(txHash);
    if (transaction && transaction.to && ROUTER_LIST.includes(transaction.to.toLowerCase())) {
        const poolsToUpdate = new Map<string, { in_token: string, out_token: string, router: string }>();
        await handleTransaction(transaction as Transaction, transaction.to.toLowerCase(), poolsToUpdate)
        await handleBlock(poolsToUpdate, transaction.hash || 0)
    }
}
    
