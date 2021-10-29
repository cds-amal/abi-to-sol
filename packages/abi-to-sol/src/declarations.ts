import {Abi as SchemaAbi} from "@truffle/contract-schema/spec";
import * as Codec from "@truffle/codec";
import * as Abi from "@truffle/abi-utils";

import {Visitor, VisitOptions, dispatch, Node} from "./visitor";

export interface Declarations {
  signatureDeclarations: {
    [signature: string]: Declaration;
  };
  containerSignatures: {
    [container: string]: string[];
  }
}

export interface Declaration {
  identifier?: string;
  components: Component[];
}

export interface Component {
  name: string;
  type: string;
  signature?: string;
}

export const collectDeclarations = (node: SchemaAbi | Node): Declarations =>
  dispatch({
    node,
    visitor: new DeclarationsCollector(),
  });

interface Context {
}

type Visit<N extends Node> = VisitOptions<N, Context | undefined>;

class DeclarationsCollector implements Visitor<Declarations, Context | undefined> {
  visitAbi({
    node: nodes,
    context
  }: Visit<Abi.Abi>): Declarations {
    return nodes
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitEventEntry({
    node: entry,
    context
  }: Visit<Abi.EventEntry>): Declarations {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitErrorEntry({
    node: entry,
    context
  }: Visit<Abi.ErrorEntry>): Declarations {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitFunctionEntry({
    node: entry,
    context
  }: Visit<Abi.FunctionEntry>): Declarations {
    return [...entry.inputs, ...(entry.outputs || [])]
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitConstructorEntry({
    node: entry,
    context
  }: Visit<Abi.ConstructorEntry>): Declarations {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitFallbackEntry({
    node: entry
  }: Visit<Abi.FallbackEntry>): Declarations {
    return emptyDeclarations();
  }

  visitReceiveEntry({
    node: entry,
  }: Visit<Abi.ReceiveEntry>): Declarations {
    return emptyDeclarations();
  }

  visitParameter({
    node: parameter
  }: Visit<Abi.Parameter>): Declarations {
    if (!parameter.type.startsWith("tuple")) {
      return emptyDeclarations();
    }

    let container = "";
    const components = parameter.components || [];
    const signature = Codec.AbiData.Utils.abiTupleSignature(components);
    const declaration: Declaration = {
      components: components.map(({name, type, components}) =>
        !components
          ? {name, type}
          : {
              name,
              type,
              signature: Codec.AbiData.Utils.abiTupleSignature(components),
            }
      ),
    };

    if ("internalType" in parameter && parameter.internalType) {
      const match = parameter.internalType.match(/struct ([^\[]+).*/);
      if (match) {
        const possiblyQualifiedIdentifier = match[1];
        const parts = possiblyQualifiedIdentifier.split(".");
        if (parts.length === 1) {
          declaration.identifier = parts[0];
        } else if (parts.length === 2) {
          container = parts[0];
          declaration.identifier = parts[1];
        }
      }
    }

    const declarations = {
      signatureDeclarations: {
        [signature]: declaration
      },
      containerSignatures: {
        [container]: [signature]
      }
    };

    const componentDeclarations: Declarations = components
      .map((component: Abi.Parameter) =>
        this.visitParameter({node: component})
      )
      .reduce(mergeDeclarations, emptyDeclarations())


    return mergeDeclarations(declarations, componentDeclarations);
  }
}

function mergeDeclarations(
  a: Declarations,
  b: Declarations
): Declarations {
  const declarations: Declarations = {
    signatureDeclarations: {
      ...a.signatureDeclarations,
      ...b.signatureDeclarations
    },
    containerSignatures: {
      ...a.containerSignatures,
      // add b iteratively separately to merge arrays
    }
  };

  for (const [container, signatures] of Object.entries(b.containerSignatures)) {
    const mergedSignatures = new Set([
      ...(declarations.containerSignatures[container] || []),
      ...signatures
    ])

    declarations.containerSignatures[container] = [...mergedSignatures];
  }

  return declarations;
}

function emptyDeclarations(): Declarations {
  return {
    signatureDeclarations: {},
    containerSignatures: {}
  };
}
