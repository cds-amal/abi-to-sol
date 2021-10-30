import type Prettier from "prettier";
import * as Codec from "@truffle/codec";
import * as Abi from "@truffle/abi-utils";
import {Abi as SchemaAbi} from "@truffle/contract-schema/spec";

import { version } from "../package.json";
import {Visitor, VisitOptions, dispatch, Node} from "./visitor";
import { forRange, VersionFeatures, mixed } from "./version-features";
import * as defaults from "./defaults";
import {
  Component,
  Declaration,
  Declarations,
  Identifier,
  collectDeclarations,
} from "./declarations";
import { collectAbiFeatures, AbiFeatures } from "./abi-features";

let prettier: typeof Prettier
try {
  prettier = require("prettier");
} catch {
  // no-op
}


export interface GenerateSolidityOptions {
  abi: Abi.Abi | SchemaAbi;
  name?: string;
  solidityVersion?: string;
  license?: string;
  prettifyOutput?: boolean;
}

export const generateSolidity = ({
  abi,
  name = defaults.name,
  solidityVersion = defaults.solidityVersion,
  license = defaults.license,
  prettifyOutput = prettier && defaults.prettifyOutput,
}: GenerateSolidityOptions) => {
  if (!prettier && prettifyOutput) {
    throw new Error("Could not require() prettier");
  }

  const versionFeatures = forRange(solidityVersion);
  const abiFeatures = collectAbiFeatures(abi);
  const declarations = collectDeclarations(abi);

  const generated = dispatch({
    node: abi,
    visitor: new SolidityGenerator({
      name,
      solidityVersion,
      license,
      versionFeatures,
      abiFeatures,
      declarations,
    }),
  });

  if (!prettifyOutput) {
    return generated;
  }

  try {
    return prettier.format(generated, {
      plugins: ["prettier-plugin-solidity"],
      // @ts-ignore
      parser: "solidity-parse",
    });
  } catch (error) {
    return generated;
  }
};

interface Context {
  interfaceName?: string;
  parameterModifiers?: (parameter: Abi.Parameter) => string[];
}

type Visit<N extends Node> = VisitOptions<N, Context | undefined>;

type ConstructorOptions = {
  versionFeatures: VersionFeatures;
  abiFeatures: AbiFeatures;
  declarations: Declarations;
} & Required<
  Omit<GenerateSolidityOptions, "abi" | "prettifyOutput">
>;

const shimGlobalInterfaceName = "__Structs";

class SolidityGenerator implements Visitor<string, Context | undefined> {
  private name: string;
  private license: string;
  private solidityVersion: string;
  private versionFeatures: VersionFeatures;
  private abiFeatures: AbiFeatures;
  private declarations: Declarations;

  constructor({
    name,
    license,
    solidityVersion,
    versionFeatures,
    abiFeatures,
    declarations,
  }: ConstructorOptions) {
    this.name = name;
    this.license = license;
    this.solidityVersion = solidityVersion;
    this.versionFeatures = versionFeatures;
    this.abiFeatures = abiFeatures;
    this.declarations = declarations;
  }

  visitAbi({node: abi}: Visit<Abi.Abi>) {
    return [
      this.generateHeader(),
      this.generateInterface(abi),
      this.generateDeclarations(),
      this.generateAutogeneratedNotice(abi),
    ].join("\n\n");
  }

  visitFunctionEntry({node: entry, context}: Visit<Abi.FunctionEntry>): string {
    const {name, inputs, stateMutability} = entry;

    return [
      `function ${name}(`,
      entry.inputs.map((node) =>
        dispatch({
          node,
          visitor: this,
          context: {
            ...context,
            parameterModifiers: (parameter: Abi.Parameter) =>
              parameter.type.startsWith("tuple") ||
              parameter.type.includes("[") ||
              parameter.type === "bytes" ||
              parameter.type === "string"
                ? [this.generateArrayParameterLocation(parameter)]
                : [],
          },
        })
      ),
      `) external`,
      this.generateStateMutability(entry),
      entry.outputs && entry.outputs.length > 0
        ? [
            `returns (`,
            entry.outputs
              .map((node) =>
                dispatch({
                  node,
                  visitor: this,
                  context: {
                    parameterModifiers: (parameter: Abi.Parameter) =>
                      parameter.type.startsWith("tuple") ||
                      parameter.type.includes("[") ||
                      parameter.type === "bytes" ||
                      parameter.type === "string"
                        ? ["memory"]
                        : [],
                  },
                })
              )
              .join(", "),
            `)`,
          ].join("")
        : ``,
      `;`,
    ].join(" ");
  }

  visitConstructorEntry({node: entry}: Visit<Abi.ConstructorEntry>): string {
    // interfaces don't have constructors
    return "";
  }

  visitFallbackEntry({ node: entry }: Visit<Abi.FallbackEntry>): string {
    const servesAsReceive = this.abiFeatures["defines-receive"] &&
       this.versionFeatures["receive-keyword"] !== true;

    const { stateMutability } = entry;
    return `${this.generateFallbackName()} () external ${
      stateMutability === "payable" || servesAsReceive ? "payable" : ""
     };`;
  }

  visitReceiveEntry() {
    // if version has receive, emit as normal
    if (this.versionFeatures["receive-keyword"] === true) {
      return `receive () external payable;`;
    }

    // if this ABI defines a fallback separately, emit nothing, since
    // visitFallbackEntry will cover it
    if (this.abiFeatures["defines-fallback"]) {
      return "";
    }

    // otherwise, explicitly invoke visitFallbackEntry
    return this.visitFallbackEntry({
      node: { type: "fallback", stateMutability: "payable" },
    });
  }

  visitEventEntry({node: entry, context}: Visit<Abi.EventEntry>): string {
    const {name, inputs, anonymous} = entry;

    return [
      `event ${name}(`,
      inputs.map((node) =>
        dispatch({
          node,
          visitor: this,
          context: {
            ...context,
            parameterModifiers: (parameter: Abi.Parameter) =>
              // TODO fix this
              (parameter as Abi.EventParameter).indexed ? ["indexed"] : [],
          },
        })
      ),
      `)`,
      `${anonymous ? "anonymous" : ""};`,
    ].join(" ");
  }

  visitErrorEntry({node: entry, context}: Visit<Abi.ErrorEntry>): string {
    if (this.versionFeatures["custom-errors"] !== true) {
      throw new Error("ABI defines custom errors; use Solidity v0.8.4 or higher");
    }

    const {name, inputs} = entry;

    return [
      `error ${name}(`,
      inputs.map((node) =>
        dispatch({
          node,
          visitor: this,
          context: {
            ...context,
            parameterModifiers: (parameter: Abi.Parameter) => []
          },
        })
      ),
      `);`,
    ].join(" ");
  }

  visitParameter({node: parameter, context}: Visit<Abi.Parameter>) {
    const type = this.generateType(parameter, context);

    // @ts-ignore
    const {parameterModifiers} = context;

    return [type, ...parameterModifiers(parameter), parameter.name].join(" ");
  }

  private generateHeader(): string {
    const includeExperimentalPragma =
      this.abiFeatures["needs-abiencoder-v2"] &&
      this.versionFeatures["abiencoder-v2"] !== "default";

    return [
      `// SPDX-License-Identifier: ${this.license}`,
      `// !! THIS FILE WAS AUTOGENERATED BY abi-to-sol v${version}. SEE SOURCE BELOW. !!`,
      `pragma solidity ${this.solidityVersion};`,
      ...(
        includeExperimentalPragma
          ? [`pragma experimental ABIEncoderV2;`]
          : []
      )
    ].join("\n");
  }

  private generateAutogeneratedNotice(abi: Abi.Abi): string {
    return [
      ``,
      `// THIS FILE WAS AUTOGENERATED FROM THE FOLLOWING ABI JSON:`,
      `/*`,
      JSON.stringify(abi),
      `*/`,
    ].join("\n");
  }

  private generateDeclarations(): string {
    if (
      this.versionFeatures["structs-in-interfaces"] !== true &&
      Object.keys(this.declarations.signatureDeclarations).length > 0
    ) {
      throw new Error(
        "abi-to-sol does not support custom struct types for this Solidity version"
      );
    }

    const externalContainers = Object.keys(this.declarations.containerSignatures)
      .filter(container => container !== "" && container !== this.name);

    const externalDeclarations = externalContainers
      .map(container => [
        `interface ${container} {`,
          this.generateDeclarationsForContainer(container),
        `}`
      ].join("\n"))
      .join("\n\n");

    const globalSignatures = this.declarations.containerSignatures[""] || [];
    if (globalSignatures.length > 0) {
      const declarations = this.versionFeatures["global-structs"] === true
        ? this.generateDeclarationsForContainer("")
        : [
            `interface ${shimGlobalInterfaceName} {`,
            this.generateDeclarationsForContainer(""),
            `}`
          ].join("\n");

      return [declarations, externalDeclarations].join("\n\n");
    }

    return externalDeclarations;
  }

  private generateDeclarationsForContainer(container: string): string {
    const signatures = new Set(
      this.declarations.containerSignatures[container]
    );

    if (container === "" && this.versionFeatures["global-structs"] !== true) {
      container = shimGlobalInterfaceName;
    }

    return Object.entries(this.declarations.signatureDeclarations)
      .filter(([signature]) => signatures.has(signature))
      .map(([signature, declaration]) => {
        const { identifier: { name } } = declaration;
        const components = this.generateComponents(declaration, { interfaceName: container });

        return `struct ${name} { ${components} }`;
      })
      .join("\n\n");
  }

  private generateComponents(
    declaration: Declaration,
    context?: Pick<Context, "interfaceName">
  ): string {
    return declaration.components
      .map((component) => {
        const {name} = component;

        return `${this.generateType(component, context)} ${name};`;
      })
      .join("\n");
  }

  private generateType(
    variable: Abi.Parameter | Component,
    context: Pick<Context, "interfaceName"> = {}
  ): string {
    const { type } = variable;

    const signature = this.generateSignature(variable);

    if (!signature) {
      return type;
    }

    const declaration = this.declarations.signatureDeclarations[signature];

    const { identifier: { container, name } } = declaration;

    return this.generateStructType({ type, container, name }, context);
  }

  private generateStructType(
    variable: Identifier & Pick<Abi.Parameter, "type">,
    context: Pick<Context, "interfaceName"> = {}
  ): string {
    const { type, name, container } = variable;

    if (container && container !== context.interfaceName) {
      return type.replace("tuple", `${container}.${name}`);
    }

    if (!container && this.versionFeatures["global-structs"] !== true) {
      return type.replace("tuple", `${shimGlobalInterfaceName}.${name}`);
    }

    return type.replace("tuple", name);
  }

  private generateSignature(
    variable: Abi.Parameter | Component
  ): string | undefined {
    if ("signature" in variable && variable.signature) {
      return variable.signature;
    }

    if ("components" in variable && variable.components) {
      return Codec.AbiData.Utils.abiTupleSignature(variable.components);
    }
  }

  private generateStateMutability(
    entry:
      | Abi.FunctionEntry
      | Abi.FallbackEntry
      | Abi.ConstructorEntry
      | Abi.ReceiveEntry
  ): string {
    if (entry.stateMutability && entry.stateMutability !== "nonpayable") {
      return entry.stateMutability;
    }

    return "";
  }

  private generateFallbackName(): string {
    switch (this.versionFeatures["fallback-keyword"]) {
      case true: {
        return "fallback";
      }
      case false: {
        return "function";
      }
      case mixed: {
        throw new Error(
          `Desired Solidity range lacks unambigious fallback syntax.`
        );
      }
    }
  }

  private generateArrayParameterLocation(parameter: Abi.Parameter): string {
    switch (this.versionFeatures["array-parameter-location"]) {
      case undefined: {
        return "";
      }
      case mixed: {
        throw new Error(
          `Desired Solidity range lacks unambiguous location specifier for ` +
          `parameter of type "${parameter.type}".`
        );
      }
      default: {
        return this.versionFeatures["array-parameter-location"];
      }
    }
  }

  private generateInterface(abi: Abi.Abi): string {
    return [
      `interface ${this.name} {`,
        this.generateDeclarationsForContainer(this.name),
        ``,
        ...abi.map((node) => dispatch({
          node,
          context: { interfaceName: this.name },
          visitor: this
        })),
      `}`,
    ].join("\n");
  }
}
