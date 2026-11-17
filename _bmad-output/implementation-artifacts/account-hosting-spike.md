# Account App Hosting Spike (Phase 0) — VERDICT: **PASS**

Spike of spine decision **AD-14**: CloudFront → Lambda Web Function origin via OAC, static assets from S3 behind the same distribution, TanStack Start built as a plain Node server, Node 24.

| | |
|---|---|
| Date | 2026-11-17 |
| Account / Region | `760573627796` / `us-east-1` |
| Stack | `nixus-account-spike` (throwaway, **deleted** — see §8) |
| CloudFront domain | `d2guo43452463a.cloudfront.net` (distribution `E13HFKFNBZP7BG`) |
| Web Function endpoint | `hchr2w36s0vf2phl.86k.lambda-web.us-east-1.on.aws` |
| Runtime observed | `nodejs24.x` → **`process.version === v24.22.3`** |

## 1. Results

| # | Check | Result |
|---|---|---|
| a | 302 redirect with `Location` header through CloudFront | **PASS** |
| b | `__Host-` cookie set, arrives intact at client, sent back, echoed by server | **PASS** (curl + real browser) |
| c | TanStack Start `createServerFn({ method: 'POST' })` round-trip with JSON body | **PASS** (curl + real headless Chromium click) |
| d | Web Function endpoint domain NOT directly invokable without CloudFront | **PASS** (403) |
| e | Static asset served from S3 origin behind the same distribution (`/assets/*`) | **PASS** |

No fallback needed. Nitro was **not** used. Lambda Web Adapter was **not** needed. Function URL + origin-secret was **not** needed.

## 2. Versions actually installed

App (`package.json` dependencies / devDependencies):

| Package | Version |
|---|---|
| `@tanstack/react-start` | **1.167.65** (pinned `~1.167.65`) |
| `@tanstack/react-router` | 1.169.2 |
| `vite` | **7.3.8** (react-start 1.167 peer is `vite >=7.0.0`; 1.169+ requires Vite 8 — do not bump) |
| `@vitejs/plugin-react` | 5.2.0 |
| `react` / `react-dom` | 19.3.1 / 19.3.1 |

Transitive runtime closure pulled in by react-start 1.167.65 (these are what the server bundle imports at runtime):

| Package | Version |
|---|---|
| `@tanstack/router-core` | 1.169.2 |
| `@tanstack/history` | 1.161.6 |
| `@tanstack/start-server-core` | 1.167.30 |
| `@tanstack/start-client-core` | 1.168.2 |
| `@tanstack/start-plugin-core` | 1.169.20 (build-time only) |
| `srvx` | 0.11.22 |
| `h3-v2` | 2.0.1-rc.20 |
| `seroval` | 1.8.1 |

| Other | Version |
|---|---|
| **nitro / nitropack** | **not used** |
| Lambda runtime | `nodejs24.x` → v24.22.3 |
| Local Node (build machine) | v25.2.1 |
| `playwright` (browser check) | 1.65.1 (chromium-headless-shell 159.0.8154.6) |
| boto3 (for `lambda-web` client) | 1.44.4 via `uvx --with boto3` |
| local `aws` CLI | 2.27.4 — **too old for `lambda-web`**; `cloudformation deploy` and `s3`/`cloudfront` subcommands are fine |

## 3. The app: TanStack Start as a plain Node server (no Nitro)

Key finding: **TanStack Start 1.167.x `vite build` already emits a plain Node-compatible fetch server.** No Nitro preset, no adapter.

- `vite build` produces:
  - `dist/server/server.js` — ESM module whose **default export is `{ fetch(request): Response }`**. It does *not* listen and does *not* serve static files.
  - `dist/client/assets/*` — client bundle, URLs are `/assets/*`.
- A ~15-line entry wrapper turns that fetch handler into a listening Node server using `srvx` (already in the dependency closure — it is what TanStack Start uses itself).
- Because static assets are served by CloudFront from S3, the Lambda server deliberately serves **no** static files. Check (e) proves the S3 origin covers `/assets/*`.

### `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
})
```

### `src/router.tsx` — the export MUST be named `getRouter`

```ts
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

> **Gotcha:** naming it `createRouter` fails the client build with
> `"getRouter" is not exported by "src/router.tsx", imported by ".../hydrateStart.js"`.
> `#tanstack-router-entry` resolves to `src/router.tsx` and requires the symbol `getRouter`.

### Route patterns used (all three spine-critical primitives)

`src/routes/redirect.tsx` — framework redirect, renders as a real 302 on SSR:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/redirect')({
  beforeLoad: () => {
    throw redirect({ to: '/', statusCode: 302 })
  },
  component: () => null,
})
```

`src/routes/cookie.tsx` — server route handler + `setCookie`. In 1.167 server handlers live on the
route's `server.handlers` object (no separate `createServerFileRoute`):

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { setCookie } from '@tanstack/react-start/server'

export const Route = createFileRoute('/cookie')({
  server: {
    handlers: {
      GET: () => {
        setCookie('__Host-spike', 'spike-value-123', {
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        })
        return new Response(JSON.stringify({ set: '__Host-spike' }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
```

`src/routes/echo.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { getCookies, getRequestHeader } from '@tanstack/react-start/server'

export const Route = createFileRoute('/echo')({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({
            cookies: getCookies(),
            rawCookieHeader: getRequestHeader('cookie') ?? null,
            nodeVersion: process.version,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    },
  },
})
```

`src/routes/index.tsx` — POST server fn called from the client:

```tsx
export const spikeEcho = createServerFn({ method: 'POST' })
  .inputValidator((d: { ping: string }) => d)
  .handler(async ({ data }) => ({
    ok: true,
    received: data.ping,
    runtime: 'node',
    nodeVersion: process.version,
    at: new Date().toISOString(),
  }))
```

> Note the builder method is **`.inputValidator()`**, not `.validator()`, in this version.

## 4. The Lambda Web Function entry wrapper

Deployment package layout (zip root):

```
index.js                 <- entry wrapper (runtime loads index.js at package root by default)
package.json             <- { "type": "module" }  (required: wrapper is ESM)
server/                  <- copy of dist/server/
node_modules/            <- runtime closure (see §2); NO native .node binaries
```

`index.js`:

```js
// AWS Lambda Web Function entry wrapper for a TanStack Start plain-Node server build.
// Lambda sets AWS_LAMBDA_HTTP_ENDPOINT to "host:port"; the server MUST bind to it within 10s.
import { serve } from 'srvx'
import app from './server/server.js'

const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? '127.0.0.1:3000'
const sep = endpoint.lastIndexOf(':')
const hostname = endpoint.slice(0, sep)
const port = Number(endpoint.slice(sep + 1))

const server = serve({
  hostname,
  port,
  // CloudFront terminates TLS; Lambda forwards plain HTTP and sets X-Forwarded-*.
  trustProxy: true,
  fetch: (request) => app.fetch(request),
})

await server.ready()
console.log(`[spike] listening on ${hostname}:${port} node=${process.version}`)
```

Facts this relies on (verified against the AWS docs and by observation):

- `AWS_LAMBDA_HTTP_ENDPOINT` format is **`host:port`** (not a URL). Split on the **last** `:`.
- Server must begin listening **within 10 s** of start. Lambda does **not** verify this — an `Active`
  revision/endpoint with a non-listening server just returns errors at request time.
- Lambda loads **`index.js` at the package root** by default; override with `AWS_LAMBDA_NODEJS_ENTRYPOINT`.
- Lambda terminates TLS at the endpoint and forwards **plain HTTP**; `X-Forwarded-*` is populated.
- Lambda adds `lambda-web-request-id` / `lambda-web-logstream` response headers (visible in all the
  evidence below — a convenient proof that a response really came from the Web Function).
- Web Function memory is fixed at 2 GB; there is **no** `Architectures`/`MemorySize` property. Keep the
  zip free of native binaries (we deleted `lightningcss-darwin-arm64` etc. from the runtime closure).

### Build + package commands

```bash
npm run build                                     # vite build -> dist/client + dist/server

mkdir -p lambda && cp -R dist/server lambda/server
printf '{"type":"module"}\n' > lambda/package.json   # plus index.js from above
cp -R node_modules lambda/node_modules
# strip build-only / native packages from the runtime closure
rm -rf lambda/node_modules/{vite,rollup,@rollup,@vitejs,esbuild,@esbuild,typescript,.bin,.vite} \
       lambda/node_modules/{prettier,@babel,lightningcss*,zod,caniuse-lite,jiti,undici} \
       lambda/node_modules/@tanstack/{router-plugin,router-generator,start-plugin-core,router-utils}

cd lambda && zip -rq ../app.zip . -x "*.map"      # 4,872,167 bytes / 68 packages
```

### Local test before deploying (mirrors the Lambda contract)

```bash
cd lambda && AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:8080 node index.js
# -> [spike] listening on 127.0.0.1:8080 node=v25.2.1
curl -i http://127.0.0.1:8080/redirect   # 302 + location: /
curl -i http://127.0.0.1:8080/cookie     # set-cookie: __Host-spike=...
```

## 5. S3 buckets (created out-of-band, before the stack)

```bash
export AWS_PROFILE=temp AWS_DEFAULT_REGION=us-east-1
aws s3api create-bucket --bucket nixus-account-spike-code-760573627796
aws s3api create-bucket --bucket nixus-account-spike-assets-760573627796

# MANDATORY: Lambda Web stores code by REFERENCE and requires bucket versioning
aws s3api put-bucket-versioning --bucket nixus-account-spike-code-760573627796 \
  --versioning-configuration Status=Enabled

aws s3 cp app.zip s3://nixus-account-spike-code-760573627796/app.zip
aws s3 sync dist/client/ s3://nixus-account-spike-assets-760573627796/ --exclude "*.map"
# -> objects land at assets/index-*.js etc., matching the /assets/* behaviour
```

> **Gotcha 1 (cost us a failed stack):** without bucket versioning,
> `CreateWebFunctionRevision` fails with
> `You must enable S3 versioning for your S3 bucket when S3ObjectStorageMode is set to REFERENCE.`
>
> **Gotcha 2 (cost us a second failed stack):** the **code** bucket needs a bucket policy granting
> `lambda.amazonaws.com` `s3:GetObject` + `s3:GetObjectVersion`, otherwise:
> `Lambda service principal lambda.amazonaws.com does not have s3:GetObject and s3:GetObjectVersion
> permission on s3://.../app.zip`. It is in the template below with an explicit `DependsOn`.

## 6. CloudFormation template (verbatim, deployed successfully)

Deploy with:

```bash
aws cloudformation deploy --template-file spike.yaml --stack-name nixus-account-spike \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
```

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: nixus-account-spike - CloudFront -> Lambda Web Function (OAC) + S3 static assets (OAC).

Parameters:
  CodeBucket:
    Type: String
    Default: nixus-account-spike-code-760573627796
  CodeKey:
    Type: String
    Default: app.zip
  AssetsBucket:
    Type: String
    Default: nixus-account-spike-assets-760573627796

Resources:

  # ---------- Lambda Web Function execution role ----------
  ExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: nixus-account-spike-exec
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      Policies:
        - PolicyName: logs
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - logs:CreateLogGroup
                  - logs:CreateLogStream
                  - logs:PutLogEvents
                Resource:
                  # Web Functions use /aws/lambda/web/<fn> plus a ".local" per-Region group.
                  - !Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/web/nixus-account-spike-fn:*'
                  - !Sub 'arn:aws:logs:*:${AWS::AccountId}:log-group:/aws/lambda/web/nixus-account-spike-fn.local:*'

  # ---------- Code bucket policy: Lambda Web reads the zip as the service principal ----------
  CodeBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref CodeBucket
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Sid: AllowLambdaWebReadCode
            Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action:
              - s3:GetObject
              - s3:GetObjectVersion
            Resource: !Sub 'arn:aws:s3:::${CodeBucket}/*'
            Condition:
              StringEquals:
                aws:SourceAccount: !Ref AWS::AccountId

  # ---------- Lambda Web Function ----------
  WebFunction:
    Type: AWS::Lambda::WebFunction
    Properties:
      FunctionName: nixus-account-spike-fn

  WebFunctionRevision:
    Type: AWS::Lambda::WebFunctionRevision
    DependsOn: CodeBucketPolicy
    Properties:
      FunctionName: !Ref WebFunction
      Description: spike r1
      BuildConfig:
        CodeConfig:
          S3Object:
            Bucket: !Ref CodeBucket
            Key: !Ref CodeKey
        RuntimeConfig:
          Runtime: nodejs24.x
      ServiceConfig:
        ExecutionRoleArn: !GetAtt ExecutionRole.Arn
        TimeoutSeconds: 30

  WebFunctionEndpoint:
    Type: AWS::Lambda::WebFunctionEndpoint
    Properties:
      FunctionName: !Ref WebFunction
      EndpointName: nixus-account-spike-ep
      EndpointType: HomeRegion
      AuthType: IamAuth
      RevisionWeights:
        - RevisionId: !GetAtt WebFunctionRevision.RevisionId
          Weight: 100

  # ---------- Origin Access Controls ----------
  LambdaOac:
    Type: AWS::CloudFront::OriginAccessControl
    Properties:
      OriginAccessControlConfig:
        Name: nixus-account-spike-lambda-oac
        Description: OAC for Lambda Web Function origin
        OriginAccessControlOriginType: lambda
        SigningBehavior: always-amz-auth
        SigningProtocol: sigv4

  S3Oac:
    Type: AWS::CloudFront::OriginAccessControl
    Properties:
      OriginAccessControlConfig:
        Name: nixus-account-spike-s3-oac
        Description: OAC for S3 static assets origin
        OriginAccessControlOriginType: s3
        SigningBehavior: always
        SigningProtocol: sigv4

  # ---------- CloudFront distribution ----------
  Distribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Comment: nixus-account-spike
        Enabled: true
        HttpVersion: http2and3
        IPV6Enabled: true
        PriceClass: PriceClass_100
        Origins:
          - Id: lambda-web
            DomainName: !GetAtt WebFunctionEndpoint.DomainName
            OriginAccessControlId: !GetAtt LambdaOac.Id
            CustomOriginConfig:
              OriginProtocolPolicy: https-only
              HTTPSPort: 443
              OriginSSLProtocols:
                - TLSv1.2
          - Id: s3-assets
            DomainName: !Sub '${AssetsBucket}.s3.${AWS::Region}.amazonaws.com'
            OriginAccessControlId: !GetAtt S3Oac.Id
            S3OriginConfig:
              OriginAccessIdentity: ''
        DefaultCacheBehavior:
          TargetOriginId: lambda-web
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]
          CachedMethods: [GET, HEAD]
          Compress: true
          # managed CachingDisabled
          CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad
          # managed AllViewerExceptHostHeader (Host MUST NOT be forwarded)
          OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac
        CacheBehaviors:
          - PathPattern: /assets/*
            TargetOriginId: s3-assets
            ViewerProtocolPolicy: redirect-to-https
            AllowedMethods: [GET, HEAD]
            CachedMethods: [GET, HEAD]
            Compress: true
            # managed CachingOptimized
            CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6

  # ---------- S3 bucket policy for the assets OAC ----------
  AssetsBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref AssetsBucket
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Sid: AllowCloudFrontServicePrincipalReadOnly
            Effect: Allow
            Principal:
              Service: cloudfront.amazonaws.com
            Action: s3:GetObject
            Resource: !Sub 'arn:aws:s3:::${AssetsBucket}/*'
            Condition:
              StringEquals:
                AWS:SourceArn: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${Distribution}'

Outputs:
  DistributionDomain:
    Value: !GetAtt Distribution.DomainName
  DistributionId:
    Value: !Ref Distribution
  DistributionArn:
    Value: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${Distribution}'
  WebFunctionArn:
    Value: !GetAtt WebFunction.FunctionArn
  EndpointArn:
    Value: !GetAtt WebFunctionEndpoint.EndpointArn
  EndpointDomain:
    Value: !GetAtt WebFunctionEndpoint.DomainName
  RevisionId:
    Value: !GetAtt WebFunctionRevision.RevisionId
```

### CloudFront / OAC facts that are non-negotiable

| Setting | Value | Why |
|---|---|---|
| Lambda OAC `OriginAccessControlOriginType` | `lambda` | |
| Lambda OAC `SigningBehavior` | **`always-amz-auth`** | CloudFront rejects every other signing behaviour for Web Function origins. It signs with a CloudFront-specific header *and* forwards the viewer's own `Authorization` header unmodified — so app-level auth (JWT/cookies) still works on an `IamAuth` endpoint. |
| Lambda OAC `SigningProtocol` | `sigv4` | `sigv4a` only for `MultiRegion` (`*.lambda-web.global.on.aws`) endpoints. |
| Endpoint `AuthType` | **`IamAuth`** | Required for OAC. `ApplicationManaged` = publicly invokable. |
| Origin config | `CustomOriginConfig` / `https-only` / `HTTPSPort: 443` | Web Function endpoints are HTTPS-only. Not an S3 origin. |
| Origin request policy | **`AllViewerExceptHostHeader`** = `b689b0a8-53d0-40ab-baf2-68738e2966ac` | The endpoint requires `Host` == its own domain. Forwarding the viewer's `Host` yields **404**. Do **not** use `AllViewer`. |
| Cache policy (dynamic) | `CachingDisabled` = `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` | TTL 0, nothing cached → no risk of caching a personalised `Set-Cookie`. |
| Cache policy (`/assets/*`) | `CachingOptimized` = `658327ea-f89d-4fab-a63d-7e88639e58f6` | Hashed filenames, immutable. |
| POST/PUT bodies | signed as **UNSIGNED-PAYLOAD**, automatically | Unlike plain Lambda *Function URLs*, Web Functions do **not** require the client to send `x-amz-content-sha256`. This is why check (c) works with a plain JSON body. |
| Lambda@Edge | **not allowed** on a behaviour using a Lambda Web origin + OAC | Use CloudFront Functions if edge logic is needed. |

### Resource-based policy — NOT a CloudFormation resource

Must be applied after the stack (needs the distribution ID). The local `aws` CLI 2.27.4 has no
`lambda-web` command, so use boto3:

```bash
cat > resource-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOACAccess",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "lambda:InvokeWebFunctionEndpoint",
      "Resource": "arn:aws:lambda:us-east-1:760573627796:web-function/nixus-account-spike-fn/endpoint/nixus-account-spike-ep",
      "Condition": {
        "StringEquals": {
          "aws:SourceArn": "arn:aws:cloudfront::760573627796:distribution/E13HFKFNBZP7BG"
        }
      }
    }
  ]
}
EOF

uvx --with boto3 python - <<'PY'
import boto3, json
c = boto3.client('lambda-web', region_name='us-east-1')
FN = 'arn:aws:lambda:us-east-1:760573627796:web-function/nixus-account-spike-fn'
r = c.put_resource_policy(resourceArn=FN, policy=open('resource-policy.json').read())
print('revisionId', r['revisionId'])
print(json.dumps(json.loads(c.get_resource_policy(resourceArn=FN)['policy']), indent=2))
PY
```

Notes:
- `resourceArn` is the **function** ARN; `Resource` inside the policy is the **endpoint** ARN.
- boto3 parameter names for this client are **lowerCamelCase** (`resourceArn`, `policy`, `revisionId`),
  not the usual PascalCase.
- One policy per function; `put_resource_policy` **replaces** it wholesale. Use
  `get_resource_policy` + `revisionId` for optimistic-locked merges.
- There is no `AddPermission` for Web Functions.
- boto3 1.44.4 `lambda-web` operations: `CreateWebFunction`, `CreateWebFunctionEndpoint`,
  `CreateWebFunctionRevision`, `DeleteResourcePolicy`, `DeleteWebFunction`, `DeleteWebFunctionEndpoint`,
  `DeleteWebFunctionRevision`, `GetResourcePolicy`, `GetWebAccountSettings`, `GetWebFunction`,
  `GetWebFunctionEndpoint`, `GetWebFunctionRevision`, `ListTags`, `ListWebFunctionEndpoints`,
  `ListWebFunctionRevisions`, `ListWebFunctions`, `PutResourcePolicy`, `TagResource`, `UntagResource`,
  `UpdateWebFunctionEndpoint`.

## 7. Evidence

`$CF = https://d2guo43452463a.cloudfront.net`

### (a) PASS — 302 + `Location`

```
$ curl -sSi -X GET https://d2guo43452463a.cloudfront.net/redirect
HTTP/2 302
content-type: text/plain; charset=utf-8
date: Tue, 17 Nov 2026 18:04:11 GMT
location: /
lambda-web-logstream: 2026/11/17/nixus-account-spike-fn[rev-sh0by]88d9d1427b5c4c6c8995890c9f08de45
lambda-web-request-id: GL7PLJEALK67RTRARZKCK7ZUGE
x-cache: Miss from cloudfront
via: 1.1 dc19ea23f7171b69f0ee587ccd8e6c16.cloudfront.net (CloudFront)
```

### (b) PASS — `__Host-` cookie set, retained, returned, echoed

```
$ curl -sSi -c cookiejar.txt https://d2guo43452463a.cloudfront.net/cookie
HTTP/2 200
content-type: application/json
set-cookie: __Host-spike=spike-value-123; Path=/; HttpOnly; Secure; SameSite=Lax
lambda-web-request-id: SD7RONWL2QZJF2ZPAV6NQ5ROSY
x-cache: Miss from cloudfront

{"set":"__Host-spike"}
```

```
$ cat cookiejar.txt
#HttpOnly_d2guo43452463a.cloudfront.net	FALSE	/	TRUE	0	__Host-spike	spike-value-123
```

```
$ curl -sSi -b cookiejar.txt https://d2guo43452463a.cloudfront.net/echo
HTTP/2 200
content-type: application/json
lambda-web-request-id: NGGK3YG4EELS7MHVULWHZIWC2Y

{"cookies":{"__Host-spike":"spike-value-123"},"rawCookieHeader":"__Host-spike=spike-value-123","nodeVersion":"v24.22.3"}
```

Real browser (headless Chromium) cookie jar after loading `/cookie` through CloudFront:

```
[{"name":"__Host-spike","value":"spike-value-123","domain":"d2guo43452463a.cloudfront.net",
  "path":"/","expires":-1,"httpOnly":true,"secure":true,"sameSite":"Lax"}]
echo body: {"cookies":{"__Host-spike":"spike-value-123"},"rawCookieHeader":"__Host-spike=spike-value-123","nodeVersion":"v24.22.3"}
```

### (c) PASS — `createServerFn({ method: 'POST' })` round-trip

Server-fn endpoint is `POST /_serverFn/<functionId>`; the body is the seroval encoding of
`{ data }` with `content-type: application/json`. Produce it exactly as the client does:

```bash
node -e "const{toJSONAsync}=require('seroval');(async()=>console.log(JSON.stringify(await toJSONAsync({data:{ping:'from-curl'}}))))()" > body.json
cat body.json
# {"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["ping"],"v":[{"t":1,"s":"from-curl"}]},"o":0}]},"o":0},"f":127,"m":[]}
```

```
$ curl -sSi -X POST 'https://d2guo43452463a.cloudfront.net/_serverFn/ed9ee6270f56c3ecc88e61d9d1c9535651b12eaf5053862ae9e9c4382e569425' \
    -H 'content-type: application/json' -H 'x-tsr-serverFn: true' -H 'accept: application/json' \
    --data-binary @body.json
HTTP/2 200
content-type: application/json
x-tss-serialized: true
lambda-web-request-id: JLVKFE6JYO5RTI63M6PTODN6SQ
x-cache: Miss from cloudfront

{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":10,"i":1,"p":{"k":["ok","received","runtime","nodeVersion","at"],"v":[{"t":2,"s":2},{"t":1,"s":"from-curl"},{"t":1,"s":"node"},{"t":1,"s":"v24.22.3"},{"t":1,"s":"2026-11-17T18:04:15.862Z"}]},"o":0},{"t":2,"s":1},{"t":11,"i":2,"p":{"k":[],"v":[]},"o":0}]},"o":0}
```

Decoded: `result = { ok: true, received: "from-curl", runtime: "node", nodeVersion: "v24.22.3", at: ... }`.

**Real browser** (`playwright` 1.65.1, headless chromium) — SSR page load, hydration, button click,
real `fetch` POST issued by the TanStack client:

```
--- load / ---
page status: 200
--- click button -> POST server fn ---
server-fn-result: {"ok":true,"received":"from-browser","runtime":"node","nodeVersion":"v24.22.3","at":"2026-11-17T18:05:27.301Z"}
--- follow /redirect (browser follows 302) ---
final url: https://d2guo43452463a.cloudfront.net/ status: 200
redirect chain: yes
--- network log ---
200 GET  https://d2guo43452463a.cloudfront.net/
200 GET  https://d2guo43452463a.cloudfront.net/assets/routes-DDMb3FxN.js
200 GET  https://d2guo43452463a.cloudfront.net/assets/index-Bc2Dj53N.js
200 POST https://d2guo43452463a.cloudfront.net/_serverFn/ed9ee6270f56c3ecc88e61d9d1c9535651b12eaf5053862ae9e9c4382e569425
200 GET  https://d2guo43452463a.cloudfront.net/cookie
200 GET  https://d2guo43452463a.cloudfront.net/echo
302 GET  https://d2guo43452463a.cloudfront.net/redirect
200 GET  https://d2guo43452463a.cloudfront.net/
```

No console errors, no page errors. Hydration is proven by the click working at all.

### (d) PASS — direct endpoint access denied

```
$ curl -sSi https://hchr2w36s0vf2phl.86k.lambda-web.us-east-1.on.aws/
HTTP/1.1 403 Forbidden
content-type: text/html
lambda-web-request-id: 42ICHW7QNKRNYLZEXHFI4NEF5A
content-length: 230

<!DOCTYPE html>
<html>
<head>
    <title>HTTP Error 403</title>
```

### (e) PASS — asset from the S3 origin behind the same distribution

```
$ curl -sSi https://d2guo43452463a.cloudfront.net/assets/routes-DDMb3FxN.js
HTTP/2 200
content-type: text/javascript
content-length: 420
server: AmazonS3
etag: "28efcedddbc81b31dd3e52fb365d3847"
x-cache: Miss from cloudfront

import{r as n,j as s,s as o}from"./index-Bc2Dj53N.js";function c(){...}
```

`server: AmazonS3` and the absence of `lambda-web-*` headers confirm it was served by the S3 origin.

## 8. Teardown — CONFIRMED DELETED

Teardown order that works:

```bash
# 1. resource policy (not owned by CFN)
uvx --with boto3 python -c "
import boto3; boto3.client('lambda-web',region_name='us-east-1').delete_resource_policy(
  resourceArn='arn:aws:lambda:us-east-1:760573627796:web-function/nixus-account-spike-fn')"

# 2. empty buckets (versioned -> must delete versions AND delete markers)
aws s3api delete-objects --bucket <code-bucket> --delete "$(aws s3api list-object-versions \
  --bucket <code-bucket> --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)"
aws s3 rm s3://<assets-bucket>/ --recursive

# 3. stack (disables + deletes the distribution, OACs, web function, role, bucket policies)
aws cloudformation delete-stack --stack-name nixus-account-spike
aws cloudformation wait stack-delete-complete --stack-name nixus-account-spike

# 4. buckets + log groups
aws s3api delete-bucket --bucket <code-bucket>
aws s3api delete-bucket --bucket <assets-bucket>
aws logs delete-log-group --log-group-name /aws/lambda/web/nixus-account-spike-fn
```

> Note: deleting the stack deletes the CloudFront distribution; CFN disables it first, which takes
> several minutes. Budget ~10–20 min for `stack-delete-complete`.

### Proof of deletion

```
$ aws cloudformation describe-stacks --stack-name nixus-account-spike
An error occurred (ValidationError) when calling the DescribeStacks operation:
Stack with id nixus-account-spike does not exist

$ aws cloudformation list-stacks --query "StackSummaries[?contains(StackName,'spike')].[StackName,StackStatus,DeletionTime]" --output text
nixus-account-spike	DELETE_COMPLETE	2026-11-17T18:08:28.927000+00:00
nixus-account-spike	DELETE_COMPLETE	2026-11-17T17:58:19.597000+00:00   <- failed attempt (S3 versioning)
nixus-account-spike	DELETE_COMPLETE	2026-11-17T17:53:38.090000+00:00   <- failed attempt (code bucket policy)

$ uvx --with boto3 python -c "import boto3;print(boto3.client('lambda-web',region_name='us-east-1').list_web_functions().get('webFunctions',[]))"
webFunctions: []

$ aws s3api list-buckets --query "Buckets[?contains(Name,'spike')].Name" --output text
(empty)

$ aws cloudfront list-distributions --query "DistributionList.Items[].[Id,DomainName,Comment]" --output text
ERVZVNKVLP7TP	d2od7whajazy70.cloudfront.net
E691EEFVS0K6N	d2qtb4uo4upbx2.cloudfront.net	Cloudfront for landing page of Nixus app
E39FCWVISAOWBF	d1hm2osaiojjsd.cloudfront.net
# -> E13HFKFNBZP7BG (the spike distribution) is gone; the 3 above are pre-existing and untouched

$ aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[].[Id,Name]" --output text
ECSCO0MWGO0B2	finance-perso-dev-oac
E3EXHBG5QJ0DIX	oac-nixus-web-cdn.s3.us-east-1.amazonaws.com-mp6qt8f4fm3
E1EDZW1B8B5SPS	oac-nixus-web-cdn.s3.us-east-1.amazonaws.com-msmdr6d0gfd
# -> nixus-account-spike-lambda-oac / -s3-oac are gone

$ aws logs describe-log-groups --log-group-name-prefix /aws/lambda/web/nixus-account-spike --query 'logGroups[].logGroupName' --output text
(empty)

$ aws iam get-role --role-name nixus-account-spike-exec
An error occurred (NoSuchEntity) when calling the GetRole operation:
The role with name nixus-account-spike-exec cannot be found.

$ aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query 'StackSummaries[].StackName' --output text
nixus-sync	nixus-bedrock-api	nixus-bedrock-api-bootstrap	aws-sam-cli-managed-default	amplify-admindashboard-perso-07105-authadmindashboard9035dda6-YI2YBZCCUJ4Q	amplify-admindashboard-perso-07105
# -> all pre-existing stacks intact; nothing production was touched
```

Deleted: stack `nixus-account-spike`; buckets `nixus-account-spike-code-760573627796` and
`nixus-account-spike-assets-760573627796` (all object versions + delete markers, then the buckets);
CloudFront distribution `E13HFKFNBZP7BG`; both OACs; Web Function `nixus-account-spike-fn` + revision
`rev-sh0by` + endpoint `nixus-account-spike-ep`; the function resource policy; IAM role
`nixus-account-spike-exec`; log groups `/aws/lambda/web/nixus-account-spike-fn` and `…-fn.local`.

## 9. Epic F implications

1. **No Nitro.** `@tanstack/react-start` 1.167.65 + Vite 7.3.8 + a ~15-line `srvx` wrapper is the whole
   server story. Keep react-start pinned `~1.167.65` until the project is ready for Vite 8.
2. **Pin `@tanstack/react-start` and build the runtime closure from the lockfile**, not from hand-written
   version ranges — `h3-v2@2.0.1-rc.20` is an RC that has already disappeared from the registry's
   resolvable set, so `npm install` of a hand-written manifest fails. Copy `node_modules` from the
   lockfile-resolved install and strip build-only packages.
3. **The code bucket must be versioned and must have the `lambda.amazonaws.com` read policy.** Both are
   hard preconditions of `CreateWebFunctionRevision`.
4. **`src/router.tsx` must export `getRouter`.**
5. The `/assets/*` S3 behaviour is required — the Lambda server serves no static files. If an asset path
   changes (Vite `build.assetsDir`), the CloudFront behaviour must change with it.
6. `__Host-` cookies work on the default `*.cloudfront.net` domain and will work identically on a custom
   domain (Secure + Path=/ + no Domain attribute). Session cookies for the account app are safe under AD-14.
7. For production, replace `EndpointType: HomeRegion` only if multi-Region is actually wanted; note
   `MultiRegion` forces OAC `SigningProtocol: sigv4a` and excludes opt-in Regions.
8. `AWS::Lambda::WebFunctionRevision` is fully immutable (every property is `Update requires: Replacement`),
   so each deploy creates a new revision and the endpoint's `RevisionWeights` shifts traffic — this is the
   natural canary hook for Epic F (max 2 revisions per endpoint).
