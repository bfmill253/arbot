# Advanced DeFi Arbitrage Strategy 

This project demonstrates an advanced arbitrage strategy that will discover arbitrage opportunities between two DeFi protocols and execute the arbitrage trade.

The current project can calculate triangular arbitrage opportunities across swap exchanges and leverage flash swapping to execute the trade at any value.

However, the algorithm could be extended to handle more complex arbitrage opportunities. (4+ pairs, statistical arb, etc) 

The addresses referenced in the project are for the BSC mainnet. However, this can run on any EVM compatible chain.

## Architecture
This code is experimental, so you may see redundant code and calculations. This was to explore the different ways to calculate arbitrage opportunities and execute the trade.

The code is split into 3 main parts:

`main.ts`: Entrypoint to run the bot
`runner.ts`: Calculates arbitrage opportunities and executes the trade
`strategy.ts`: Determines when and how to execute the `Runner`

The rest of the code is helper functions and test cases used to analyze the results of the strategies on the testnet.

### Off-Chain Runner
The `Runner` is the main class that calculates arbitrage opportunities and executes the trade. It is designed to be run off-chain, so it can be run on any machine that has access to the Ethereum network.

### On-Chain Runner
The `FlashBot.sol` and `FlashCalculator.sol` contracts are designed to be deployed on-chain and run as a flash bot. The `FlashBot` contract is the main entrypoint to the flash bot. It will call the `FlashCalculator` contract to calculate the arbitrage opportunity and execute the trade.

`FlashCalculator.sol` contains the same logic as the off-chain calculator in `runner.ts`

## Preliminary Results
The preliminary results show that the arbitrage strategy is profitable. However, the results are not consistent. The results are also not as profitable as expected. This is likely due to the fact that the arbitrage strategy is not optimized and the gas fees are high.

After a short period of time the rise of MEV bots pushed this bot into an unprofitable strategy as others could outbid the bot for the arbitrage opportunity.

Since the bot depends on getting executed in a particular spot inside a block it is highly susceptible to MEV bots. Since we can not predict the order of transactions in a block, we can not predict the order of execution of our transactions. This means that we can not predict the gas price we will need to pay to get our transaction executed exactly where needed.

This can be observed by running this bot in a highly controlled environment (hardhart local archive forked chain) and comparing it to real world results.
