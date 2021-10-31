import * as Abi from "@truffle/abi-utils";
import * as Codec from "@truffle/codec";

export interface Identifier {
  name: string;
  container?: string;
}

export type Type = ElementaryType | StructType;

export interface ElementaryType {
  kind: "elementary";
  parameterType: ElementaryParameterType;
}

export interface StructType {
  kind: "struct";
  parameterType: StructParameterType;
  identifier?: Identifier;
}

export interface ElementaryParameterType {
  type: string;
}

export interface StructParameterType {
  type: `tuple${string}`;
  components: Abi.Parameter[];
}

function isStructParameter(
  parameter: Abi.Parameter
): parameter is (
  & Omit<Abi.Parameter, "type" | "components">
  & {
      type: `tuple${string}`;
      components: Abi.Parameter[];
    }
) {
  return parameter.type.startsWith("tuple");
}

export function toType(parameter: Abi.Parameter): Type {
  if (!isStructParameter(parameter)) {
    const kind = "elementary";
    const { type } = parameter;

    return {
      kind,
      parameterType: {
        type
      }
    };
  }

  const kind = "struct";
  const { type, internalType = "", components } = parameter;

  const match = internalType.match(/struct ([^\[]+).*/);
  if (!match) {
    return {
      kind,
      parameterType: {
        type,
        components
      }
    }
  }

  const possiblyQualifiedIdentifier = match[1];
  const parts = possiblyQualifiedIdentifier.split(".");
  if (parts.length === 1) {
    const [name] = parts;
    return {
      kind,
      parameterType: {
        type,
        components
      },
      identifier: {
        name
      }
    };
  } else {
    const [container, name] = parts;
    return {
      kind,
      parameterType: {
        type,
        components
      },
      identifier: {
        container,
        name
      }
    };
  }
}

