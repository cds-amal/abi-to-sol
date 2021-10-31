import * as fc from "fast-check";
import {testProp} from "jest-fast-check";
import {Arbitrary} from "@truffle/abi-utils";
import * as Example from "../test/custom-example";

import {collectDeclarations} from "./declarations";

describe("collectDeclarations", () => {
  describe("arbitrary examples", () => {
    describe("for non-tuple parameters / event parameters", () => {
      testProp(
        "are empty",
        [fc.oneof(Arbitrary.Parameter(), Arbitrary.EventParameter())],
        (parameter) => {
          fc.pre(!parameter.type.startsWith("tuple"));

          const declarations = collectDeclarations(parameter);

          expect(declarations.isEmpty()).toEqual(true);
        }
      );
    });

    describe("for tuple parameters with non-tuple components", () => {
      testProp(
        "have length 1",
        [fc.oneof(Arbitrary.Parameter(), Arbitrary.EventParameter())],
        (parameter) => {
          fc.pre(parameter.type.startsWith("tuple"));
          fc.pre(
            parameter.components.every(
              (component: any) => !component.type.startsWith("tuple")
            )
          );

          const declarations = collectDeclarations(parameter);
          expect([...declarations.allDeclarations()]).toHaveLength(1);

          const [declaration] = [...declarations.allDeclarations()];
          expect(declaration).toHaveProperty("components");

          const {components} = declaration;
          expect(components).toHaveLength(parameter.components.length);

          for (const [index, component] of components.entries()) {
            expect(component.name).toEqual(parameter.components[index].name);
          }
        }
      );
    });

    describe("for tuple parameters with exactly one tuple component", () => {
      testProp(
        "have length 2",
        [fc.oneof(Arbitrary.Parameter(), Arbitrary.EventParameter())],
        (parameter) => {
          fc.pre(parameter.type.startsWith("tuple"));

          // find exactly one tuple-based component
          const tupleComponents = parameter.components.filter(
            (component: any) => component.type.startsWith("tuple")
          );

          fc.pre(tupleComponents.length === 1);

          const [tupleComponent] = tupleComponents;

          fc.pre(
            tupleComponent.components.every(
              (component: any) => !component.type.startsWith("tuple")
            )
          );

          const declarations = collectDeclarations(parameter);
          expect([...declarations.allDeclarations()]).toHaveLength(2);
        }
      );
    });

    testProp(
      "produce only valid references to each other",
      [fc.oneof(Arbitrary.Parameter(), Arbitrary.EventParameter())],
      (parameter) => {
        fc.pre(parameter.type.startsWith("tuple"));

        const components = parameter.components || [];

        const declarations = collectDeclarations(parameter);

        for (const {components} of declarations.allDeclarations()) {
          for (const component of components) {
            const { type } = component;

            if (type.kind === "struct") {
              const { identifier } = type;
              console.debug("identifier %o", identifier);
              console.debug("all declarations %o", declarations.allDeclarations());

              const declaration = declarations.identifierDeclaration(
                identifier
              );
              expect(declaration).not.toBeUndefined();
            }
          }
        }
      },
      { seed: 858696588, path: "42:0:0:0:0:0", endOnFailure: true }
    );
  });

  describe("custom example", () => {
    const declarations = collectDeclarations(Example.abi);

    for (const [structName, declaration] of Object.entries(
      Example.expectedDeclarations
    )) {
      describe(`struct ${structName}`, () => {
        it("exists in declarations", () => {
          expect(
            declarations.identifierDeclaration({
              name: structName
            })
          ).not.toBeUndefined();
        });

        const {
          components: expectedComponents
        } = Example.expectedDeclarations[structName];

        const declaration = declarations.identifierDeclaration({
          name: structName
        });

        // we cover this in the it() block above, so just return here to
        // satisfy the type-checker.
        if (!declaration) {
          return;
        }

        for (const expectedComponent of expectedComponents) {
          const { name: componentName } = expectedComponent;

          describe(`component ${componentName}`, () => {
            it("exists in declarations", () => {
              const names = declaration.components.map(({name}) => name);
              expect(names).toContain(componentName);
            });

            const component = declaration.components.find(
              ({name}) => name === componentName
            );

            // we cover this in the it() block above, so just return here
            // to satisfy the type-checker.
            if (!component) {
              return;
            }

            const { type } = component;
            const { type: expectedType } = expectedComponent;

            it("has correct type", () => {
              expect(type).toEqual(expectedType);
            });

            if (type.kind === "struct" && expectedType.kind === "struct") {
              it("has correct identifier", () => {
                expect(type.identifier).toEqual(expectedType.identifier);
              });
            }
          });
        }
      });
    }
  });
});
