import {Abi as SchemaAbi} from "@truffle/contract-schema/spec";

/**
 * Solidity used to generate this ABI:
 *
 * ```solidity
 * // SPDX-License-Identifier: UNLICENSED
 * pragma solidity ^0.8.9;
 *
 * type MyUint is uint256;
 *
 * contract TestCase {
 *   type MyOtherUint is uint256;
 *
 *   function run(MyUint x, MyOtherUint y) public pure returns (uint256) {
 *     return MyUint.unwrap(x) + MyOtherUint.unwrap(y);
 *   }
 * }
 * ```
 */
export const abi: SchemaAbi = [
  {
    "inputs": [
      {
        "internalType": "MyUint",
        "name": "x",
        "type": "uint256"
      },
      {
        "internalType": "TestCase.MyOtherUint",
        "name": "y",
        "type": "uint256"
      }
    ],
    "name": "run",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  }
];

export const expectedSignatures: {[name: string]: string} = {
};

export const expectedDeclarations = {
};
