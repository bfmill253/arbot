// import { expect } from "chai";
// import { ethers } from "hardhat";
// import {BiswapFactory, BiswapPair, MetaCoin, PancakeFactory, PancakePair} from "../typechain";
//
// describe("Greeter", function () {
//   before(async function () {
//     // We need to launch the exchange
//     const Biswap = await ethers.getContractFactory("BiswapFactory");
//     // get owner
//     const [owner, add1] = await ethers.getSigners();
//     const biswap = await Biswap.deploy(owner.address) as BiswapFactory;
//     await biswap.deployed();
//
//     expect(await biswap.allPairsLength()).to.equal(0);
//
//     // We need to launch the pancake exchange
//     const Pancake = await ethers.getContractFactory("PancakeFactory");
//     // get owner
//     const pancake = await Pancake.deploy(owner.address) as PancakeFactory;
//     await pancake.deployed();
//
//     expect(await pancake.allPairsLength()).to.equal(0);
//
//     // next we need to mint out our test tokens
//     const Meta = await ethers.getContractFactory("MetaCoin");
//     const metaCoin = await Meta.deploy(10000000) as MetaCoin;
//     await metaCoin.deployed();
//
//     const Omega = await ethers.getContractFactory("OmegaCoin");
//     const omegaCoin = await Omega.deploy(10000000) as MetaCoin;
//     await omegaCoin.deployed();
//
//     // next create a pair on biswap
//     const biswapTx = await biswap.createPair(metaCoin.address, omegaCoin.address)
//     await biswapTx.wait()
//
//     const pancakeTx = await pancake.createPair(metaCoin.address, omegaCoin.address)
//     await pancakeTx.wait()
//
//     // now lets get our pairs so we can fund it
//     const biswapPairAddr = await biswap.getPair(metaCoin.address, omegaCoin.address);
//     const pancakePairAddr = await pancake.getPair(metaCoin.address, omegaCoin.address);
//
//     const biswapPair = await ethers.getContractAt("BiswapPair", biswapPairAddr) as BiswapPair;
//     const pancakePair = await ethers.getContractAt("PancakePair", pancakePairAddr) as PancakePair;
//
//     //launch WBNB to have a wrapper target
//     const WBNB = await ethers.getContractFactory("OmegaCoin");
//
//     // add 50 omega to 100 meta
//
//
//   })
//
//   it("Should return the new greeting once it's changed", async function () {
//     const Greeter = await ethers.getContractFactory("Greeter");
//
//     const greeter = await Greeter.deploy("Hello, world!");
//     await greeter.deployed();
//
//     expect(await greeter.greet()).to.equal("Hello, world!");
//
//     const setGreetingTx = await greeter.setGreeting("Hola, mundo!");
//
//     // wait until the transaction is mined
//     await setGreetingTx.wait();
//
//     expect(await greeter.greet()).to.equal("Hola, mundo!");
//   });
// });
