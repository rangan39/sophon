# ADR 0001: Backend Repository Split

## Status

Accepted: defer repository split.

## Context

Sophon currently keeps the Next.js frontend and the TransformerLens/FastAPI backend in one repository. The backend lives in `services/interp-api`, and Docker Compose wires it to the frontend for local development.

Splitting the backend into a repository such as `sophon-backend` could make Python runtime ownership, backend deployment, and release cadence clearer. It would also reduce the frontend repository surface area.

The split also creates coordination costs. Frontend changes often depend on run payload shape, error semantics, auth behavior, and local Docker Compose wiring. If those contracts are still moving quickly, a separate repository can turn one cohesive change into two synchronized pull requests.

## Decision

Do not split the backend into a separate permanent repository yet.

Keep the monorepo while formalizing the boundary:

- `services/interp-api` owns the TransformerLens runtime and HTTP API.
- `src/app/api/runs/route.ts` owns the frontend proxy from the browser-facing app to the backend API.
- `docs/api/interp-api-v1.md` documents the API contract.
- `docs/api/prompt-run.schema.json` records the stable JSON shapes consumed by the frontend.

Revisit the repository split when the API contract and deployment model are stable enough that most frontend changes can be made without editing backend code.

## Consequences

The monorepo remains the source of truth for now. Local development stays one-command through Docker Compose, and coordinated UI/API changes remain simple.

The backend boundary is explicit enough to support a later split. A future backend repository should be able to adopt the same API contract and schema without changing the frontend call path.

The cost is that frontend and backend dependencies still live in one repository. This is acceptable until backend releases, deployment ownership, or CI runtime cost become materially independent.

## Split Readiness Checklist

- The backend exposes a versioned API contract for run requests, run responses, and error responses.
- Frontend code depends on documented HTTP contracts, not backend source imports.
- CI validates the frontend against a schema fixture or generated client.
- Docker Compose can still run the frontend against a local backend checkout or remote backend URL.
- Backend deployment ownership is defined for local Docker, hosted API, and Modal deployment paths.
- Cross-repository change workflow is documented for breaking API changes.

## Migration Plan If Split Later

1. Create the backend repository from `services/interp-api`.
2. Preserve package metadata, Dockerfile, Modal app, README, and API schema.
3. Add backend CI for Python tests, type checks if adopted, and Docker image build.
4. Publish a versioned API contract artifact from the backend repository.
5. Update this repository's Compose file to build from a local backend path, a git URL, or a released image.
6. Keep `INTERP_API_URL` as the frontend integration boundary.
7. Remove backend source from this repository only after the split workflow has been proven on one end-to-end change.

