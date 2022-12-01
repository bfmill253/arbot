//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import 'hardhat/console.sol';

import './interfaces/IUniswapV2Pair.sol';
import './interfaces/IWETH.sol';
import './libraries/Decimal.sol';

struct CallbackData {
    address debtPool;
    TradeData[] trades;
    address debtToken;
    uint256 debtAmount;
}

struct TradeData {
    address pool;
    uint256 amount0Out;
    uint256 amount1Out;
    address tokenIn;
    uint256 amountIn;
}

contract FlashBot is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;



    event Withdrawn(address indexed to, uint256 indexed value);
    event BaseTokenAdded(address indexed token);
    event BaseTokenRemoved(address indexed token);

    constructor() {
    }

    receive() external payable {}

//    /// @dev Redirect uniswap callback function
//    /// The callback function on different DEX are not same, so use a fallback to redirect to uniswapV2Call
    fallback(bytes calldata _input) external returns (bytes memory) {
        (address sender, uint256 amount0, uint256 amount1, bytes memory data) = abi.decode(_input[4:], (address, uint256, uint256, bytes));
        uniswapV2Call(sender, amount0, amount1, data);
    }

    function withdraw(address token) external {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner()).transfer(balance);
            emit Withdrawn(owner(), balance);
        }

        balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            // do not use safe transfer here to prevents revert by any shitty token
            IERC20(token).transfer(owner(), balance);
        }
    }


    // pools - [(A->B), (B -> C), (C -> A)]
    // tokens - [A, B, C]
    // amount - optimalAmountIn
    function triFlashArb(address[] memory pools, address[] memory tokens, uint256 amount) external onlyOwner {
        require(pools.length == tokens.length, 'Invalid Input');
        TradeData[] memory trades = new TradeData[](pools.length - 1);
        TradeData memory start;
        uint256 amountOut = amount;
        for (uint256 i = 0; i < pools.length; i++) {
            (uint256 poolReserve0, uint256 poolReserve1, ) = IUniswapV2Pair(pools[i]).getReserves();
            (address poolToken0, address poolToken1) = (IUniswapV2Pair(pools[i]).token0(), IUniswapV2Pair(pools[i]).token1());
            TradeData memory trade;
            trade.amountIn = amountOut;
            amountOut = getAmountOut(trade.amountIn,
                                    poolToken0 == tokens[i] ? poolReserve0 : poolReserve1,
                                    poolToken0 == tokens[i] ? poolReserve1 : poolReserve0
                                    );

            // tokens[i] is the current input token
            trade.amount0Out = poolToken0 == tokens[i] ? 0 : amountOut;
            trade.amount1Out = poolToken1 == tokens[i] ? 0 : amountOut;
            trade.pool = pools[i];
            trade.tokenIn = tokens[i];
            if(i == 0){
                start = trade;
            }else{
                trades[i-1] = trade;
            }
        }
        require(amountOut > amount, 'Error 102 - Too Low');
        {
            // debtPool, debtToken, debtAmount, Trades
            bytes memory data = abi.encode(pools[0], tokens[0], amount, trades);
            IUniswapV2Pair(start.pool).swap(start.amount0Out, start.amount1Out, address(this), data);
        }
    }

    function uniswapV2Call(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes memory data
    ) public {
        // access control
        require(sender == address(this), 'Not from this contract');
        (address debtPool, address debtToken, uint256 debtAmount, TradeData[] memory trades ) = abi.decode(data, (address, address, uint256, TradeData[]));

        for(uint256 i=0; i<trades.length; i++){
            IERC20(trades[i].tokenIn).safeTransfer(trades[i].pool, trades[i].amountIn);
            IUniswapV2Pair(trades[i].pool).swap(trades[i].amount0Out, trades[i].amount1Out, address(this), new bytes(0));
        }

        IERC20(debtToken).safeTransfer(debtPool, debtAmount);
    }

    // copy from UniswapV2Library
    // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        require(amountOut > 0, 'UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint256 numerator = reserveIn.mul(amountOut).mul(1000);
        uint256 denominator = reserveOut.sub(amountOut).mul(997);
        amountIn = (numerator / denominator).add(1);
    }

    // copy from UniswapV2Library
    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, 'UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint256 amountInWithFee = amountIn.mul(997);
        uint256 numerator = amountInWithFee.mul(reserveOut);
        uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }




}
