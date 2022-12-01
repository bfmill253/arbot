pragma solidity ^0.8.0;


import '@openzeppelin/contracts/access/Ownable.sol';
import './interfaces/IUniswapV2Pair.sol';
import "./libraries/SafeMathCopy.sol";
import "./libraries/Decimal.sol";
import "./libraries/pancake/interfaces/IPancakeFactory.sol";
import 'hardhat/console.sol';

    struct CalcData {
    address token_a;
    address token_b;
    address token_c;
    address pool1;
    address pool2;
    address pool3;
}

struct ReserveData {
    uint256 pool1Reserve0;
    uint256 pool1Reserve1;
    uint256 pool2Reserve0;
    uint256 pool2Reserve1;
    uint256 pool3Reserve0;
    uint256 pool3Reserve1;
}

struct OptimalData {
    uint256 r1;
    uint256 r2;
    uint256 a1;
    uint256 a3;
    uint256 b1;
    uint256 b2;
    uint256 c2;
    uint256 c3;
    uint256 a_v;
    uint256 c_v;
    uint256 a;
    uint256 a_;
}

contract FlashCalculator is Ownable {
    using SafeMathCopy for uint256;
    using Decimal for Decimal.D256;

    /// @dev Newton’s method for caculating square root of n
    function sqrt(uint256 n) internal pure returns (uint256 res) {
        assert(n > 1);

        // The scale factor is a crude way to turn everything into integer calcs.
        // Actually do (n * 10 ^ 4) ^ (1/2)
        uint256 _n = n * 10**6;
        uint256 c = _n;
        res = _n;

        uint256 xi;
        while (true) {
            xi = (res + c / res) / 2;
            // don't need be too precise to save gas
            if (res - xi < 1000) {
                break;
            }
            res = xi;
        }
        res = res / 10**3;
    }

    function calculate(
        CalcData memory data
    ) external onlyOwner returns (uint256 arbIndex, uint256 optimalIn, uint256 profit) {
        ReserveData memory pools;
        OptimalData memory optData;
        {
            (uint256 pool1Reserve0, uint256 pool1Reserve1,) = IUniswapV2Pair(data.pool1).getReserves();
            (uint256 pool2Reserve0, uint256 pool2Reserve1,) = IUniswapV2Pair(data.pool2).getReserves();
            (uint256 pool3Reserve0, uint256 pool3Reserve1,) = IUniswapV2Pair(data.pool3).getReserves();
            pools.pool1Reserve0 = pool1Reserve0;
            pools.pool1Reserve1 = pool1Reserve1;
            pools.pool2Reserve0 = pool2Reserve0;
            pools.pool2Reserve1 = pool2Reserve1;
            pools.pool3Reserve0 = pool3Reserve0;
            pools.pool3Reserve1 = pool3Reserve1;
        }
        {
            optData.a3 = (IUniswapV2Pair(data.pool3).token0() == data.token_a ? pools.pool3Reserve0 : pools.pool3Reserve1);
            optData.a1 = (IUniswapV2Pair(data.pool1).token0() == data.token_a ? pools.pool1Reserve0 : pools.pool1Reserve1);
            optData.r1 = 997;
            optData.r2 = 1;
            optData.b1 = (IUniswapV2Pair(data.pool1).token0() == data.token_b ? pools.pool1Reserve0 : pools.pool1Reserve1);
            optData.b2 = (IUniswapV2Pair(data.pool2).token0() == data.token_b ? pools.pool2Reserve0 : pools.pool2Reserve1);
            optData.c2 = (IUniswapV2Pair(data.pool2).token0() == data.token_c ? pools.pool2Reserve0 : pools.pool2Reserve1);
            optData.c3 = (IUniswapV2Pair(data.pool3).token0() == data.token_c ? pools.pool3Reserve0 : pools.pool3Reserve1);
            {
                uint256 numerator = optData.r1.mul(optData.r2).mul(optData.a3).mul(optData.b1).mul(optData.c2);
                uint256 denominator = optData.a1.mul(optData.b2).mul(optData.c3);
                arbIndex = numerator.div(denominator);
                console.log("ArbIndex %s", arbIndex);
                require(arbIndex > 1000, 'Index Too Low');
            }
            {
                optData.a_v = calcA_V(optData);
                optData.c_v = calcC_V(optData);
                optData.a = calcA(optData);
                optData.a_ = calcA_(optData);
                optimalIn = calcOptimal(optData);
                console.log("OptimalIn %s", optimalIn);
            }
            {
                profit = getAmountOut(optimalIn, optData.a1, optData.b1);
                console.log("Profit1 %s", profit);
                profit = getAmountOut(profit, optData.b2, optData.c2);
                console.log("Profit2 %s", profit);
                profit = getAmountOut(profit, optData.c3, optData.a3);
                console.log("Profit3 %s", profit);
                profit = profit.sub(optimalIn);
                console.log("Profit final %s", profit);
                profit = convertToBNB(profit, data.token_a);
            }
        }
    }

    function calcA_V(OptimalData memory optData) internal pure returns (uint256 a_v){
        uint256 numerator = optData.a1.mul(optData.b2);
        uint256 denominator = optData.r1.mul(optData.r2).mul(optData.b1).div(1000).add(optData.b2);
        a_v = numerator.div(denominator);
    }

    function calcC_V(OptimalData memory optData) internal pure returns (uint256 c_v) {
        uint256 numerator = optData.r1.mul(optData.r2).mul(optData.b1).mul(optData.c2).div(1000);
        uint256 denominator = optData.r1.mul(optData.r2).mul(optData.b1).div(1000).add(optData.b2);
        c_v = numerator.div(denominator);
    }

    function calcA(OptimalData memory optData) internal pure returns (uint256 a) {
        uint256 numerator = optData.a_v.mul(optData.c3);
        uint256 denominator = optData.r1.mul(optData.r2).mul(optData.c_v).div(1000).add(optData.c3);
        a = numerator.div(denominator);
    }

    function calcA_(OptimalData memory optData) internal pure returns (uint256 a_) {
        uint256 numerator = optData.r1.mul(optData.r2).mul(optData.c_v).mul(optData.a3).div(1000);
        uint256 denominator = (optData.r1.mul(optData.r2).mul(optData.c_v)).div(1000).add(optData.c3);
        a_ = numerator.div(denominator);
    }

    function calcOptimal(OptimalData memory optData) internal pure returns (uint256 opt) {
        uint256 numerator = (sqrt(((optData.r1.mul(optData.r2).mul(optData.a_).mul(optData.a)).div(1000))).sub(optData.a)).mul(1000);
        uint256 denominator = optData.r1;
        opt = numerator.div(denominator);
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

    function convertToBNB(
        uint256 amountIn,
        address token
    ) internal returns (uint256 amountOut) {
        address bnb = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
        if(token == bnb){
            return amountIn;
        }
        address pancakeFactory = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
        address pair = IPancakeFactory(pancakeFactory).getPair(token, bnb);
        (uint256 pool1Reserve0, uint256 pool1Reserve1,) = IUniswapV2Pair(pair).getReserves();
        uint256 reserveIn = IUniswapV2Pair(pair).token0() == token ? pool1Reserve0 : pool1Reserve1;
        uint256 reserveOut = IUniswapV2Pair(pair).token0() == bnb ? pool1Reserve0 : pool1Reserve1;
        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
    }
}
