import {currentBlockStrategy, everySecond, memPoolStrategy} from "./strategies";


const args = process.argv.slice(2);

async function run(){
    if(!args[0] || args[0] === 'currentBlock'){
        await currentBlockStrategy()
    }else if(args[0] === 'mempool'){
        console.log('Running MemPool Strategy')
        await memPoolStrategy()
    }else if(args[0] === 'seconds'){
        console.log('Running Seconds Strategy')
        await everySecond();
    }
}

run();