import {BiswapPair, IPancakePair, PancakePair} from "../typechain";
import {BigNumber} from "bignumber.js";

declare module 'canoe-solidity';

type TokenInfo = {
    symbol: string;
    decimals: BigNumber;
    address: string;
}

type PoolInfo = {
    hashCode: string;
    valid: boolean;
    contract: PancakePair;
    contractAddress: string;
    reserve0: BigNumber;
    reserve1: BigNumber;
    token0: string;
    token1: string;
    fee: number;
    exchange: string;
}

type DecodedFunction = {
    name: string;
    params: {
        name: string;
        value: string | string[];
        type: string
    }[]
}

type PrimedPoolFile = {
    pools: PoolInfo[];
    tokens: TokenInfo[];
};

type Chain = { pools: string[], tokens: string[] };