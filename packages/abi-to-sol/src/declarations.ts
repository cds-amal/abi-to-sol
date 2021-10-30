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
  identifier: Identifier;
  components: Component[];
}

export interface Identifier {
  name: string;
  container?: string;
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
  private nextNameAssignmentIndex: number = 0;

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

    const identifier = this.generateIdentifier(parameter);
    const components = parameter.components || [];
    const signature = Codec.AbiData.Utils.abiTupleSignature(components);
    const declaration: Declaration = {
      identifier,
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

    const declarations = {
      signatureDeclarations: {
        [signature]: declaration
      },
      containerSignatures: {
        [identifier.container || ""]: [signature]
      }
    };

    const componentDeclarations: Declarations = components
      .map((component: Abi.Parameter) =>
        this.visitParameter({node: component})
      )
      .reduce(mergeDeclarations, emptyDeclarations())


    return mergeDeclarations(declarations, componentDeclarations);
  }

  private generateIdentifier(parameter: Abi.Parameter): Identifier {
    const { internalType = "" } = parameter;
    const match = internalType.match(/struct ([^\[]+).*/);
    if (!match) {
      return {
        name: this.nextAssignedName()
      };
    }

    const possiblyQualifiedIdentifier = match[1];
    const parts = possiblyQualifiedIdentifier.split(".");
    if (parts.length === 1) {
      const [name] = parts;
      return { name };
    } else if (parts.length === 2) {
      const [container, name] = parts;
      return { name, container };
    }

    // this shouldn't really happen
    return {
      name: this.nextAssignedName()
    };
  }

  private nextAssignedName(): string {
    return `S_${this.nextNameAssignmentIndex++}`;
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
