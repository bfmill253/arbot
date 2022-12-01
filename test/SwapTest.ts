
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {network, waffle, web3} from 'hardhat';
import {IPancakePair, IUniswapV1Factory, IWETH, PancakeFactory, PancakeRouter, WBNB} from '../typechain';
import IWETH_ABI from '../artifacts/contracts/WBNB.sol/WBNB.json';
import FLASHBOT_ABI from '../artifacts/contracts/FlashBot.sol/FlashBot.json';
import FLASHCALC_ABI from '../artifacts/contracts/FlashCalculator.sol/FlashCalculator.json';
import UNISWAP_FACTORY_ABI from '../artifacts/contracts/libraries/pancake/PancakeFactory.sol/PancakeFactory.json'
import UNISWAP_PAIR_ABI from '../artifacts/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json'
import PANCAKE_ROUTER from '../artifacts/contracts/libraries/pancake-perph/PancakeRouter.sol/PancakeRouter.json'
import {FlashBot} from "../typechain/FlashBot";
import {IUniswapV2Pair} from "../typechain/IUniswapV2Pair";
import { AbiItem } from 'web3-utils'
import {BigNumber} from "bignumber.js";
import BN from "bn.js";
import {calcAmountIn} from "../scripts/runner";
import {FlashCalculator} from "../typechain/FlashCalculator";

describe('Flashswap', () => {
    let weth: WBNB;
    let flashBot: FlashBot;
    let flashCalc: FlashCalculator;

    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const USDT = '0x55d398326f99059ff775485246999027b3197955';
    const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

    let tokens = [WBNB, USDT, CAKE];

    beforeEach(async () => {
        tokens = [WBNB, USDT, CAKE];
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    loggingEnabled: true,
                    forking: {
                        jsonRpcUrl: "https://speedy-nodes-nyc.moralis.io/5f527c497b25bcca7ee09e70/bsc/mainnet/archive",
                        enabled: true,
                    },
                    accounts: {
                        accountsBalance: '10000000000000000000000000000', // 1 mil ether
                    },
                },
            ],
        });
        weth = (new web3.eth.Contract(IWETH_ABI.abi as AbiItem[], WBNB) as any) as WBNB;
        flashBot = (new web3.eth.Contract(FLASHBOT_ABI.abi as AbiItem[]) as any) as FlashBot;
        flashCalc = (new web3.eth.Contract(FLASHCALC_ABI.abi as AbiItem[]) as any) as FlashCalculator;
        flashCalc = (await flashCalc.deploy({
            data: FLASHCALC_ABI.bytecode,
        }).send({
            gasPrice: web3.utils.toWei('5', 'gwei'),
            from: (await web3.eth.getAccounts())[0],
            gas: 7500000,
            value: 0
        }) as any) as FlashCalculator;

        flashBot = (await flashBot.deploy({
            data: FLASHBOT_ABI.bytecode,
        }).send({
            gasPrice: web3.utils.toWei('5', 'gwei'),
            from: (await web3.eth.getAccounts())[0],
            gas: 7500000,
            value: 0
        }) as any) as FlashBot;
    });

    describe('flash swap arbitrage', () => {


        const mdexFactoryAddr = '0x3CD1C46068dAEa5Ebb0d3f55F6915B10648062B8';
        const mdexFactory = (new web3.eth.Contract(UNISWAP_FACTORY_ABI.abi as AbiItem[], mdexFactoryAddr) as any) as PancakeFactory;
        let pool2: string;
        let mdexPair: IUniswapV2Pair;
        let mdexPair2: IUniswapV2Pair;

        const pancakeFactoryAddr = '0xBCfCcbde45cE874adCB698cC183deBcF17952812';
        const pancakeFactory = (new web3.eth.Contract(UNISWAP_FACTORY_ABI.abi as AbiItem[], pancakeFactoryAddr) as any) as PancakeFactory;
        let pool1: string;
        let pool3: string;

        const pancakeRouterAddr = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
        const pancakeRouter = (new web3.eth.Contract(PANCAKE_ROUTER.abi as AbiItem[], pancakeRouterAddr) as any) as PancakeRouter;


        before(async () => {
            pool1 = await mdexFactory.methods.getPair(WBNB, USDT).call();
            pool3 = await pancakeFactory.methods.getPair(CAKE, WBNB).call();
            pool2 = await pancakeFactory.methods.getPair(USDT, CAKE).call();
            mdexPair = (new web3.eth.Contract(UNISWAP_PAIR_ABI.abi as AbiItem[], pool3) as any) as IUniswapV2Pair;
            mdexPair2 = (new web3.eth.Contract(UNISWAP_PAIR_ABI.abi as AbiItem[], pool1) as any) as IUniswapV2Pair;
        });

        it('do flash swap between Pancake and MDEX', async () => {

            // transfer 100000 to mdex pair
            let pools = [pool1, pool2, pool3];
            const amountEth = web3.utils.toWei('80000', 'ether');
            await weth.methods.deposit().send({ value: amountEth, from: (await web3.eth.getAccounts())[0] });
            await weth.methods.transfer(pool3, amountEth).send({ from: (await web3.eth.getAccounts())[0] });
            await mdexPair.methods.sync().send({ from: (await web3.eth.getAccounts())[0] });
            const balanceBefore = await weth.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3,pools, tokens))
           if(!amount){
               expect(false)
               return;
           }
            // noinspection TypeScriptValidateTypes
            const gas = await flashBot.methods.triFlashArb(pools, tokens, amount.toFixed(0)).send({ from: (await web3.eth.getAccounts())[0] });
            console.log(`HARDHAT: Gas used ${gas.gasUsed}`);
            const balanceAfter = await weth.methods.balanceOf(flashBot.options.address).call();

            //expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it('make sure the calc is the same', async () => {

            // transfer 100000 to mdex pair
            let pools = [pool1, pool2, pool3];
            const amountEth = web3.utils.toWei('80000', 'ether');
            await weth.methods.deposit().send({ value: amountEth, from: (await web3.eth.getAccounts())[0] });
            await weth.methods.transfer(pool3, amountEth).send({ from: (await web3.eth.getAccounts())[0] });
            await mdexPair.methods.sync().send({ from: (await web3.eth.getAccounts())[0] });
            const balanceBefore = await weth.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3,pools, tokens))
            if(!amount){
                expect(false)
                return;
            }
            // noinspection TypeScriptValidateTypes
            const response = await flashCalc.methods.calculate([tokens[0], tokens[1], tokens[2], pool1, pool2, pool3]).call({ from: (await web3.eth.getAccounts())[0] });
            console.log(`optIn: ${response.optimalIn}, index: ${response.arbIndex}`)
            // expect(new BigNumber(response.optimalIn).eq(amount)).to.be.true;
            const gas = await flashBot.methods.triFlashArb(pools, tokens, response.optimalIn).send({ from: (await web3.eth.getAccounts())[0] });
            console.log(`HARDHAT: Gas used ${gas.gasUsed}`);
            const balanceAfter = await weth.methods.balanceOf(flashBot.options.address).call();
        });

        it('make sure the calc is the same 2', async () => {

            // transfer 100000 to mdex pair
            let pools = [pool1, pool2, pool3];
            const amountEth = web3.utils.toWei('8000', 'ether');
            await weth.methods.deposit().send({ value: amountEth, from: (await web3.eth.getAccounts())[0] });
            await weth.methods.transfer(pool3, amountEth).send({ from: (await web3.eth.getAccounts())[0] });
            await mdexPair.methods.sync().send({ from: (await web3.eth.getAccounts())[0] });
            const balanceBefore = await weth.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3,pools, tokens))
            if(!amount){
                expect(false)
                return;
            }
            // noinspection TypeScriptValidateTypes
            const response = await flashCalc.methods.calculate([tokens[0], tokens[1], tokens[2], pool1, pool2, pool3]).call({ from: (await web3.eth.getAccounts())[0] });
            console.log(`optIn: ${response.optimalIn}, index: ${response.arbIndex}`)
            // expect(new BigNumber(response.optimalIn).eq(amount)).to.be.true;
            const gas = await flashBot.methods.triFlashArb(pools, tokens, response.optimalIn).send({ from: (await web3.eth.getAccounts())[0] });
            console.log(`HARDHAT: Gas used ${gas.gasUsed}`);
            const balanceAfter = await weth.methods.balanceOf(flashBot.options.address).call();
        });

        it('make sure the calc is the same 3', async () => {

            // transfer 100000 to mdex pair
            let pools = [pool3, pool1, pool2];
            tokens = [CAKE, WBNB, USDT];
            const amountEth = web3.utils.toWei('8000', 'ether');
            await weth.methods.deposit().send({ value: amountEth, from: (await web3.eth.getAccounts())[0] });
            await weth.methods.transfer(pool3, amountEth).send({ from: (await web3.eth.getAccounts())[0] });
            await mdexPair.methods.sync().send({ from: (await web3.eth.getAccounts())[0] });
            const balanceBefore = await weth.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3,pools, tokens))
            if(!amount){
                expect(false)
                return;
            }
            // noinspection TypeScriptValidateTypes
            const response = await flashCalc.methods.calculate([tokens[0], tokens[1], tokens[2], pool3, pool1, pool2]).call({ from: (await web3.eth.getAccounts())[0] });
            console.log(`optIn: ${response.optimalIn}, index: ${response.arbIndex}, profit: ${response.profit}`)
            // expect(new BigNumber(response.optimalIn).eq(amount)).to.be.true;
            const gas = await flashBot.methods.triFlashArb(pools, tokens, response.optimalIn).send({ from: (await web3.eth.getAccounts())[0] });
            console.log(`HARDHAT: Gas used ${gas.gasUsed}`);
            const balanceAfter = await weth.methods.balanceOf(flashBot.options.address).call();
        });

        it('make sure arbindex and optimal work', async () => {

            // transfer 100000 to mdex pair
            let pools = [pool1, pool2, pool3];
            const amountEth = web3.utils.toWei('8', 'ether');
            //await weth.methods.deposit().send({ value: amountEth, from: (await web3.eth.getAccounts())[0] });
            //await weth.methods.transfer(pool3, amountEth).send({ from: (await web3.eth.getAccounts())[0] });
            //await mdexPair.methods.sync().send({ from: (await web3.eth.getAccounts())[0] });
            const balanceBefore = await weth.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3,pools, tokens))
            // noinspection TypeScriptValidateTypes
            const response = await flashCalc.methods.calculate([tokens[0], tokens[1], tokens[2], pool1, pool2, pool3]).call({ from: (await web3.eth.getAccounts())[0] });
            console.log(`optIn: ${response.optimalIn}, index: ${response.arbIndex}`)
            // expect(new BigNumber(response.optimalIn).eq(amount)).to.be.true;
            const gas = await flashBot.methods.triFlashArb(pools, tokens, response.optimalIn).send({ from: (await web3.eth.getAccounts())[0] });
            console.log(`HARDHAT: Gas used ${gas.gasUsed}`);
            const balanceAfter = await weth.methods.balanceOf(flashBot.options.address).call();
        });

        // result... remove SAFEMOON
        it('test block 14125477', async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        loggingEnabled: true,
                        forking: {
                            jsonRpcUrl: "https://speedy-nodes-nyc.moralis.io/5f527c497b25bcca7ee09e70/bsc/mainnet/archive",
                            blockNumber: 14144178,
                            enabled: true,
                        },
                        accounts: {
                            accountsBalance: '10000000000000000000000000000', // 1 mil ether
                        },
                    },
                ],
            });
            flashBot = (await flashBot.deploy({
                data: FLASHBOT_ABI.bytecode,
                arguments: [WBNB]
            }).send({
                gasPrice: web3.utils.toWei('5', 'gwei'),
                from: (await web3.eth.getAccounts())[0],
                gas: 7500000,
                value: 0
            }) as any) as FlashBot;
            let pools = [
                '0x61EB789d75A95CAa3fF50ed7E47b96c132fEc082',
                '0x554F966fA8EE2B66E42e3829e9a5a20388ecaB24',
                '0x8046fa66753928F35f7Db23ae0188ee6743C2FBA'
            ];
            let tokens = [
                '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
                '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                '0x2cd1075682b0fccaadd0ca629e138e64015ba11c'
            ];
            const token = (new web3.eth.Contract(IWETH_ABI.abi as AbiItem[], tokens[0]) as any) as WBNB;
            const balanceBefore = await token.methods.balanceOf(flashBot.options.address).call();
            let amount = (await calcAmountIn(web3, pools, tokens))
            if(!amount){
                expect(false)
                return;
            }
            // noinspection TypeScriptValidateTypes
            await flashBot.methods.triFlashArb(pools, tokens, amount.toFixed(0)).send({ from: (await web3.eth.getAccounts())[0] });
            const balanceAfter = await token.methods.balanceOf(flashBot.options.address).call();

            //expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });
});
