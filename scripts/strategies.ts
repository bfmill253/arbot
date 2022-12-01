
import {web3, web3Ws} from "./constants";
import {nextBlockEst, primePools, setBlockType, setNextBlockEst} from "./store";
import {handleBlock, handleNewBlock, handlePendingTransaction} from "./runner";
import {BigNumber} from "bignumber.js";


export async function currentBlockStrategy() {

    // fetch all pairs to seed our pool
    await primePools();

    /**
     * 1. Listen to transaction in the mempool
     * 2. Calculate the amounts (including fees and gas) for each exchange
     * 3. If discrepancies, check for profits.
     *
     */

    const sub = web3Ws.eth.subscribe("newBlockHeaders", (err, result) => {

    });
    sub.on("data", async (data) => {
        const blockNumber = data.number;
        console.log(`new block: ${data.number} at ${Date.now()}`)
        handleNewBlock(blockNumber);
    })
    sub.on("error", async (err) => {
        console.error(err)
    })
}

export async function memPoolStrategy() {
    setBlockType('pending');
    // fetch all pairs to seed our pool
    await primePools();
    const sub = web3Ws.eth.subscribe("pendingTransactions", (err, result) => {

    });
    sub.on("data", async (data) => {
        handlePendingTransaction(data);
    })
    sub.on("error", async (err) => {
        console.error(err)
    })
}

export async function everySecond() {
    setBlockType('pending');
    // fetch all pairs to seed our pool
    await primePools();
    const sub = web3Ws.eth.subscribe("newBlockHeaders", (err, result) => {

    });
    sub.on("data", async (data) => {
        console.log(`new block: ${data.number} at ${Date.now()}`)
        setNextBlockEst(new BigNumber(data.timestamp).plus(3000).toNumber());
    })
    sub.on("error", async (err) => {
        console.error(err)
    })
    while(true){
        await handleBlock(new Map(), nextBlockEst);
    }
}