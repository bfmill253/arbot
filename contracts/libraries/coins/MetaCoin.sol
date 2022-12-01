// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

// This is just a simple example of a coin-like contract.
// It is not standards compatible and cannot be expected to talk to other
// coin/token contracts. If you want to create a standards-compliant
// token, see: https://github.com/ConsenSys/Tokens. Cheers!

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MetaCoin is ERC20 {
	constructor(uint256 initialSupply) ERC20("Gold", "GLD") {
		_mint(msg.sender, initialSupply);
	}
}
