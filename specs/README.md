# Specs

Directorio de planes de prueba para los subagentes de Playwright (`playwright-test-planner` /
`playwright-test-generator`).

**El plan canónico de pruebas E2E vive en
[`docs/features/testing/playwright-test-plan.md`](../docs/features/testing/playwright-test-plan.md)**
(matriz de 180 escenarios E001–E180, suites, prioridades, seed y riesgos). Cómo ejecutar la suite:
[`docs/features/testing/RUNBOOK.md`](../docs/features/testing/RUNBOOK.md).

Al generar specs con `playwright-test-generator`, pasarle los escenarios del plan canónico como
entrada (por suite, en orden P0 → P1 → P2). Los planes intermedios que el planner guarde aquí son
material de trabajo — el documento de `docs/` es la fuente de verdad.
