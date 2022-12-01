import {flashBot, overRideWeb3, PANCAKE_ROUTER_ADDRESS, ROUTER_LIST} from "./constants";
import {network, web3} from "hardhat";
import {poolIndexByAddress, poolInfoMap, tokenInfo, updatePool, validatePool} from "./store";
import {calcAmountIn, callArbContract, handleTransaction} from "./runner";
import {Transaction} from "web3/eth/types";
import colors from "colors";

/**
 * Run an analysis for an attempted block using hardhat forked network
 *
 * 1. Take starting block number (block before)
 * 2. Take the current state of our chain
 * 3. get the expected state of the chain (from output)
 * 4. grab the next block and al transactions (start block + 1)
 * 5. list all transactions that have to do with our chain in order (just output)
 * 6. execute each transaction [as wallet] until we get to ours
 * 7. check the state of LP reserves vs expected state
 */

/**
 * EXAMPLE
 *
 Block:      0x175087905222d11b9cdf4f24377b2d872fdd222636dd404506a9c1aa31e20c71
 Index:      0.017248825202
 OptimalIn:  2.377284177396 WBNB
 AmountOut:  2.412076714167 WBNB
 Profit:     0.034792536770 WBNB
 Profit Est: 0.034792536770 BNB
 Net Profit: 0.026792536770 BNB

 WBNB/BUSD(PancakeSwap: 0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16)
 token0: 4.98738042991338442800237e+23 WBNB token1: 2.14828552450412468193746096e+26 BUSD ->
 BUSD/BCOIN(PancakeSwap: 0xd76026a78a2A9aF2f9F57fe6337eED26Bfc26AED)
 token0: 5.37636640411836980768799e+23 BCOIN token1: 1.299613253937801622579855e+24 BUSD ->
 BCOIN/WBNB(PancakeSwap: 0x2Eebe0C34da9ba65521E98CBaA7D97496d05f489)
 token0: 2.35744757607051172254694e+23 BCOIN token1: 1.353890013582087902654e+21 WBNB

 startBlock = 14212458
 tokens = [
 '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
 '0xe9e7cea3dedca5984780bafc599bd69add087d56',
 '0x00e1656e45f18ec6747f5a8496fd39b50b38396d'
 ]
 pools = [
 '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16',
 '0xd76026a78a2A9aF2f9F57fe6337eED26Bfc26AED',
 '0x2Eebe0C34da9ba65521E98CBaA7D97496d05f489'
 ]
 */

// list of token addresses
const tokens = [
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'.toLowerCase(),
    '0xe9e7cea3dedca5984780bafc599bd69add087d56'.toLowerCase(),
    '0x00e1656e45f18ec6747f5a8496fd39b50b38396d'.toLowerCase()
]
// list of pool addresses
const pools = [
    '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16'.toLowerCase(),
    '0x886F4Bda1B0f54E2e4B80A2C115bcd2ba8B9EE2F'.toLowerCase(),
    '0x2Eebe0C34da9ba65521E98CBaA7D97496d05f489'.toLowerCase()
]
const startBlock = 14281552;
const triggerTx = '0x175087905222d11b9cdf4f24377b2d872fdd222636dd404506a9c1aa31e20c71';
const ourTx = '0x9ac729eec1b00a374b2fe9ac5803e278bb8b9a58c2a7ec146d2908625840fae9';
const ourPosition = 700;
const transactionsRan: string[] = [];

async function runAnalysis() {
    overRideWeb3(web3);
    // get the block before we reset
    const interestedBlock = await web3.eth.getBlock(startBlock + 1, true);
    // Reset to start block
    await resetToBlock(startBlock)
    // load pools into memory
    for (const pool of pools) {
        await validatePool(pool.toLowerCase(), PANCAKE_ROUTER_ADDRESS)
    }
    let trigger = false;
    // run a print out of the interest block to manually review
    for (const transaction of interestedBlock.transactions) {
        if (transaction && transaction.to && ROUTER_LIST.includes(transaction.to.toLowerCase())) {
            const poolsToUpdate = new Map<string, { in_token: string, out_token: string, router: string }>();
            await handleTransaction(transaction as Transaction, transaction.to.toLowerCase(), poolsToUpdate);
            if (poolsToUpdate.size > 0) {
                // some pool was updated
                for (let [key, value] of poolsToUpdate) {
                    const pool = poolInfoMap[key];
                    if (!pool) continue;
                    const token1 = tokenInfo[pool.token1];
                    const token0 = tokenInfo[pool.token0];
                    if (pools.includes(pool.contractAddress.toLowerCase())) {
                        // our pool was updated
                        const message = [``,
                            `Tx:    ${transaction.hash}`,
                            `Index: ${transaction.transactionIndex}`,
                            `${token0.symbol}/${token1.symbol} (${pool.exchange}: ${pool.contractAddress})`].join("\n")
                        if (transaction.hash === triggerTx) {
                            console.log(colors.blue(message))
                            trigger = (transaction.transactionIndex as number) < ourPosition;
                        } else if (transaction.hash === ourTx) {
                            console.log(colors.green(message))
                        } else {
                            console.log(colors.yellow(message))
                        }
                    }
                }
            }
        }
        await runTransaction(transaction as Transaction, trigger);
    }
}

async function runTransaction(transaction: Transaction, attempt: boolean) {
    if (transactionsRan.includes(transaction.hash)) return;
    transactionsRan.push(transaction.hash)
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [transaction.from],
    });
    await web3.eth.sendTransaction({
        to: transaction.to,
        from: transaction.from,
        value: transaction.value,
        data: transaction.input,
        gas: transaction.gas,
        gasPrice: transaction.gasPrice
    }).catch(err => {
        console.log(colors.red(`Transaction: ${transaction.hash} failed`))
    })
    await getPoolStats(transaction.hash, transaction.transactionIndex);
    if (attempt) {
        const amount = await calcAmountIn(web3, pools, tokens)
        if(amount){
            await callArbContract(pools, tokens, amount)
        }
    }
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [transaction.from],
    });
}

async function getPoolStats(txHash: string, txPLace: number) {
    const startToken = tokenInfo[tokens[0]];
    const token2 = tokenInfo[tokens[1]];
    const token3 = tokenInfo[tokens[2]];
    const pool = poolIndexByAddress[pools[0]];
    const pool2 = poolIndexByAddress[pools[1]];
    const pool3 = poolIndexByAddress[pools[2]];
    await updatePool(pool);
    await updatePool(pool2);
    await updatePool(pool3);

    console.log(colors.white([``, `Tx: ${txHash} Place: ${txPLace}`,
        `${startToken.symbol}/${token2.symbol}(${pool.exchange}: ${pool.contract.options.address})`,
        `token0: ${pool.reserve0} ${tokenInfo[pool.token0].symbol} token1: ${pool.reserve1} ${tokenInfo[pool.token1].symbol} ->`,
        `${token2.symbol}/${token3.symbol}(${pool2.exchange}: ${pool2.contract.options.address})`,
        `token0: ${pool2.reserve0} ${tokenInfo[pool2.token0].symbol} token1: ${pool2.reserve1} ${tokenInfo[pool2.token1].symbol} ->`,
        `${token3?.symbol}/${startToken.symbol}(${pool3?.exchange}: ${pool3?.contract.options.address})`,
        `token0: ${pool3.reserve0} ${tokenInfo[pool3.token0].symbol} token1: ${pool3.reserve1} ${tokenInfo[pool3.token1].symbol}`].join("\n")))
}

async function resetToBlock(block: number) {
    await network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                loggingEnabled: true,
                forking: {
                    jsonRpcUrl: "https://speedy-nodes-nyc.moralis.io/5f527c497b25bcca7ee09e70/bsc/mainnet/archive",
                    blockNumber: block,
                    enabled: true,
                },
                accounts: {
                    accountsBalance: '10000000000000000000000000000', // 1 mil ether
                },
            },
        ],
    });
}

runAnalysis();