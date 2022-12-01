import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});
const BSC_RPC =  'https://morning-dark-frost.bsc.quiknode.pro/849fd344470317da1f690047ef08995d43764e88/';
import deployer from './.secret';

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: { compilers: [{version: "0.8.4"}, {version: "0.5.16"}, {version: "0.6.6"}, {version: "0.7.0"}]},
  networks: {
    hardhat: {
      //loggingEnabled: true,
      forking: {
        url: BSC_RPC,
        enabled: true,
      },
      accounts: {
        accountsBalance: '10000000000000000000000000000', // 1 mil ether
      },
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    bsc: {
      url: BSC_RPC,
      chainId: 0x38,
      accounts: [deployer.private],
      from: deployer.address
    },
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 11,
    token: 'BNB',
    gasPriceApi:'https://api.bscscan.com/api?module=proxy&action=eth_gasPrice',
    enabled: false
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  typechain: {
    target: 'web3-v1'
  },
  mocha:{
    timeout: 200000
  }
};

export default config;
