import {Abi as SchemaAbi} from "@truffle/contract-schema/spec";
import * as Codec from "@truffle/codec";
import * as Abi from "@truffle/abi-utils";

import {Visitor, VisitOptions, dispatch, Node} from "../visitor";

export interface CollectedDeclarations {
  /**
   * Returns whether or not the visited ABI makes use of custom struct types.
   *
   * @dev This is just a convenient helper method, since we'll need to check
   *      for old solc versions that don't support custom structs in the ABI.
   */
  isEmpty(): boolean; // helper, since old solc doesn't allow ABI structs

  /**
   * Returns the set of container names that are found to define at least one
   * custom struct type.
   */
  structContainerNames(): Set<string>;

  /**
   * Returns declaration information for all observed structs in the visited
   * ABI that appear to be defined globally (i.e., outside contract/interface)
   */
  globalDeclarations(): Set<Declaration>;

  /**
   * Returns declaration information for all observed structs in the visited
   * ABI that appear to be defined in a container with given name
   */
  containerDeclarations(containerName: string): Set<Declaration>;

  /**
   * Returns the declaration for a given parameter or component
   */
  identifierDeclaration(identifier: Identifier): Declaration | undefined;

  /**
   * Returns a Type for a given parameter
   */
  typeForParameter(parameter: Abi.Parameter): Type;

  /**
   * Return all declarations regardless of their container
   */
  allDeclarations(): Set<Declaration>;
}

/**
 * Information about a struct suitable for generating code from
 */
export interface Declaration {
  identifier: Identifier;
  components: Component[];
}

export interface AnonymousDeclarationWithAnonymousComponents {
  identifier?: Identifier;
  components: AnonymousComponent[];
}

export interface DeclarationWithAnonymousComponents {
  identifier: Identifier;
  components: AnonymousComponent[];
}

/**
 * Information about an individual struct's component
 */
export interface Component {
  name: string;
  type: Type;
}

export interface AnonymousComponent {
  name: string;
  type: AnonymousType;
}

/**
 * Information necessary for referencing a variable's type
 */
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
  parameterType: StructParameterType
  identifier: Identifier;
}

export type ParameterType = ElementaryParameterType | StructParameterType;

export interface ElementaryParameterType {
  type: string;
}

export interface StructParameterType {
  type: `tuple${string}`;
  components: Abi.Parameter[];
}


type AnonymousType =
  | ElementaryType
  | (
      & Omit<StructType, "identifier">
      & { identifier?: Identifier }
    );

interface AnonymousDeclarationsWithAnonymousComponents {
  signatureDeclarations: {
    [signature: string]: AnonymousDeclarationWithAnonymousComponents[];
  };
  containerSignatures: {
    [container: string]: string[];
  }
}

interface DeclarationsWithAnonymousComponents {
  signatureDeclarations: {
    [signature: string]: DeclarationWithAnonymousComponents[];
  };
  containerSignatures: {
    [container: string]: string[];
  }
}

interface Declarations {
  signatureDeclarations: {
    [signature: string]: Declaration[];
  };
  containerSignatures: {
    [container: string]: string[];
  }
}

export const collectDeclarations = (
  node: SchemaAbi | Node
): CollectedDeclarations => {
  const anonymousDeclarations = dispatch({
    node,
    visitor: new DeclarationsCollector(),
  });

  const declarations = populateMissingIdentifiers(anonymousDeclarations);

  return {
    isEmpty() {
      return Object.keys(declarations.signatureDeclarations).length === 0;
    },

    structContainerNames() {
      return new Set(Object.keys(declarations.containerSignatures));
    },

    globalDeclarations() {
      const signatures = declarations.containerSignatures[""];
      return new Set(
        signatures
          .map(
            (signature) => declarations.signatureDeclarations[signature]
              .filter(
                ({ identifier: { container } }) => container === undefined
              )
          )
          .reduce((a, b) => [...a, ...b], [])
      );
    },

    containerDeclarations(containerName: string) {
      const signatures = declarations.containerSignatures[containerName];
      return new Set(
        signatures
          .map(
            (signature) => declarations.signatureDeclarations[signature]
              .filter(
                ({ identifier: { container } }) => container === containerName
              )
          )
          .reduce((a, b) => [...a, ...b], [])
      );
    },

    identifierDeclaration(identifier: Identifier) {
      return Object.values(declarations.signatureDeclarations)
        .reduce((a, b) => [...a, ...b], [])
        .find(
          (declaration) =>
          declaration.identifier.name === identifier.name &&
          declaration.identifier.container === identifier.container
        );
    },

    typeForParameter(parameter: Abi.Parameter) {
      const { type, components } = parameter;
      // HACK either check is redundant here assuming well-formed input
      if (!type.startsWith("tuple") || !components) {
        return {
          kind: "elementary",
          parameterType: {
            type
          }
        };
      }

      const signature = Codec.AbiData.Utils.abiTupleSignature(components);

      const declarationsForSignature =
        declarations.signatureDeclarations[signature] || [];

      if (declarationsForSignature.length === 0) {
        throw new Error(
          `Internal error: unknown declaration for signature ${signature}`
        );
      }

      const [{ identifier }] = declarationsForSignature;

      return {
        kind: "struct",
        // HACK there's probably a way to type-guard this
        parameterType: {
          type: type as `tuple${string}`,
          components
        },
        identifier
      }
    },

    allDeclarations() {
      return new Set(
        Object.values(declarations.signatureDeclarations)
          .reduce((a, b) => [...a, ...b], [])
      );
    }
  }
}


interface Context {
}

type Visit<N extends Node> = VisitOptions<N, Context | undefined>;

class DeclarationsCollector implements Visitor<AnonymousDeclarationsWithAnonymousComponents, Context | undefined> {
  private nextNameAssignmentIndex: number = 0;

  visitAbi({
    node: nodes,
    context
  }: Visit<Abi.Abi>): AnonymousDeclarationsWithAnonymousComponents {
    return nodes
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitEventEntry({
    node: entry,
    context
  }: Visit<Abi.EventEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitErrorEntry({
    node: entry,
    context
  }: Visit<Abi.ErrorEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitFunctionEntry({
    node: entry,
    context
  }: Visit<Abi.FunctionEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return [...entry.inputs, ...(entry.outputs || [])]
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitConstructorEntry({
    node: entry,
    context
  }: Visit<Abi.ConstructorEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return entry.inputs
      .map((node) => dispatch({node, context, visitor: this}))
      .reduce(mergeDeclarations, emptyDeclarations());
  }

  visitFallbackEntry({
    node: entry
  }: Visit<Abi.FallbackEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return emptyDeclarations();
  }

  visitReceiveEntry({
    node: entry,
  }: Visit<Abi.ReceiveEntry>): AnonymousDeclarationsWithAnonymousComponents {
    return emptyDeclarations();
  }

  visitParameter({
    node: parameter
  }: Visit<Abi.Parameter>): AnonymousDeclarationsWithAnonymousComponents {
    const type = this.generateType(parameter);

    if (type.kind !== "struct") {
      return emptyDeclarations();
    }

    const components = (parameter.components || [])
      .map((component) => {
        const { name } = component;
        const type = this.generateType(component);

        return { name, type };
      });

    const signature = Codec.AbiData.Utils.abiTupleSignature(
      parameter.components || []
    );

    const declaration = "identifier" in type
      ? {
          identifier: type.identifier,
          components
        }
      : { components };

    const declarations: AnonymousDeclarationsWithAnonymousComponents = {
      signatureDeclarations: {
        [signature]: [declaration]
      },
      containerSignatures: {
        [type.identifier?.container || ""]: [signature]
      }
    };

    const componentDeclarations: AnonymousDeclarationsWithAnonymousComponents = components
      .map((component: Abi.Parameter) =>
        this.visitParameter({node: component})
      )
      .reduce(mergeDeclarations, emptyDeclarations())


    return mergeDeclarations(declarations, componentDeclarations);
  }

  private generateType(parameter: Abi.Parameter): Type | AnonymousType {
    const parameterType: string | `tuple${string}` = parameter.type;

    // type guard because startsWith() isn't powerful enough
    const isStructType = (
      parameterType: Type["parameterType"]
    ): parameterType is `tuple${string}` => parameterType.startsWith("tuple");

    if (!isStructType(parameterType)) {
      const kind = "elementary";
      return {
        kind,
        parameterType
      };
    }

    const kind = "struct";

    const { internalType = "" } = parameter;
    const match = internalType.match(/struct ([^\[]+).*/);
    if (!match) {
      return {
        kind,
        parameterType
      };
    }

    const possiblyQualifiedIdentifier = match[1];
    const parts = possiblyQualifiedIdentifier.split(".");
    if (parts.length === 1) {
      const [name] = parts;
      return { kind, parameterType, identifier: { name } };
    } else if (parts.length === 2) {
      const [container, name] = parts;
      return { kind, parameterType, identifier: { container, name } };
    }

    // this shouldn't really happen
    return {
      kind,
      parameterType
    };
  }

  private nextAssignedName(): string {
    return `S_${this.nextNameAssignmentIndex++}`;
  }
}

function mergeDeclarations(
  a: AnonymousDeclarationsWithAnonymousComponents,
  b: AnonymousDeclarationsWithAnonymousComponents
): AnonymousDeclarationsWithAnonymousComponents {
  const declarations: AnonymousDeclarationsWithAnonymousComponents = {
    signatureDeclarations: {
      ...a.signatureDeclarations,
      // add b iteratively separately to merge arrays
    },
    containerSignatures: {
      ...a.containerSignatures,
      // add b iteratively separately to merge arrays
    }
  };

  for (const [
    signature, declarationsForSignature
  ] of Object.entries(b.signatureDeclarations)) {
    const mergedDeclarations: AnonymousDeclarationWithAnonymousComponents[] = [
      ...(declarations.signatureDeclarations[signature] || [])
    ]

    for (const declaration of declarationsForSignature) {
      const existing = mergedDeclarations.find(
        ({ identifier: { container, name } }) =>
          container === declaration.identifier.container &&
          name === declaration.identifier.name
      );

      if (!existing) {
        mergedDeclarations.push(declaration);
      }
    }
  }

  for (const [container, signatures] of Object.entries(b.containerSignatures)) {
    const mergedSignatures = new Set([
      ...(declarations.containerSignatures[container] || []),
      ...signatures
    ])

    declarations.containerSignatures[container] = [...mergedSignatures];
  }

  return declarations;
}

function emptyDeclarations(): AnonymousDeclarations {
  return {
    signatureDeclarations: {},
    containerSignatures: {}
  };
}

function populateMissingIdentifiers(
  anonymousDeclarations: AnonymousDeclarationsWithAnonymousComponents
): Declarations {
  let index = 0;

  const declarationsWithAnonymousComponents = {
    ...anonymousDeclarations
  };

  // ensure all top-level declarations have identifiers
  for (const [
    signature, anonymousDeclarationsForSignature
  ] of Object.entries(anonymousDeclarations.signatureDeclarations)) {
    const declarationsForSignature: DeclarationWithAnonymousComponents[] = [];
    for (const declaration of anonymousDeclarationsForSignature) {
      const { identifier, components } = declaration;
      if (identifier !== undefined) {
        declarationsForSignature.push({ identifier, components });
      } else {
        declarationsForSignature.push({
          identifier: {
            name: `S_${index++}`
          },
          ...declaration
        });
      }
    }
    declarationsWithAnonymousComponents.signatureDeclarations[signature] =
      declarationsForSignature;
  }

  return {
    containerSignatures: anonymousDeclarations.containerSignatures,
    signatureDeclarations: populateSignatureDeclarations(
      declarationsWithAnonymousComponents.signatureDeclarations
    )
  };
}

function populateSignatureDeclarations(
  signatureDeclarationsWithAnonymousComponents: {
    [signature: string]: DeclarationWithAnonymousComponents[];
  }
): {
  [signature: string]: Declaration[];
} {
  const signatureDeclarations: {
    [signature: string]: Declaration[];
  } = {};

  for (const [
    signature, declarationsWithAnonymousComponentsForSignature
  ] of Object.entries(signatureDeclarationsWithAnonymousComponents)) {
    const declarationsForSignature: Declaration[] = [];
    for (const {
      identifier, components: anonymousComponents
    } of declarationsWithAnonymousComponentsForSignature) {
      declarationsForSignature.push({
        identifier,
        components: populateComponents(
          anonymousComponents, signatureDeclarationsWithAnonymousComponents
        )
      });
    }

    signatureDeclarations[signature] = declarationsForSignature;
  }

  return signatureDeclarations;
}

function populateComponents(
  anonymousComponents: AnonymousComponent[],
  signatureDeclarations: {
    [signature: string]: DeclarationWithAnonymousComponents[]
  }
): Component[] {

  return anonymousComponents.map((anonymousComponent) => {
    const { type } = anonymousComponent;

    if (type.kind === "elementary") {
      return anonymousComponent as Component;
    }

    if (type.identifier) {
      return anonymousComponent as Component;
    }

    const { parameterType } = type;

    const signature = Codec.AbiData.Utils.abiTupleSignature(components);

    const [declaration] = signatureDeclarations[signature];

    if (!declaration) {
      throw new Error("Internal error: signature not found in declarations");
    }

    const { identifier } = declaration;

    return {
      ...anonymousComponent,
      type: {
        ...type,
        identifier
      }
    };

  });


}
