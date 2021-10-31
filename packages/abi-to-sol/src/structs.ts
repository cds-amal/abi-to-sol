import * as Abi from "@truffle/abi-utils";
import * as Codec from "@truffle/codec";

import {
  Identifier,
  StructType,
  Type,
  toType,
} from "./parameters";

export type CompleteType =
  | Exclude<Type, StructType>
  | CompleteStructType;

export type CompleteStructType =
  & Omit<StructType, "identifier">
  & { identifier: Identifier };

export interface SignatureTypes {
  [signature: string]: CompleteStructType[];
}

function isCompleteType(type: Type): type is CompleteType {
  return !!(type.kind !== "struct" || type.identifier);
}

export function toCompleteType(
  parameter: Abi.Parameter,
  signatureTypes: SignatureTypes
): CompleteType {
  const type = toType(parameter);

  if (isCompleteType(type)) {
    return type;
  }

  const { parameterType: { components } } = type;

  const signature = Codec.AbiData.Utils.abiTupleSignature(components);
  const [match] = signatureTypes[signature] || [];

  if (!match) {
    throw new Error(`Unknown struct type with signature ${signature}`);
  }

  return {
    ...type,
    identifier: match.identifier
  };
}
