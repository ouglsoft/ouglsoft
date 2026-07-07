Dhamet Cloudflare Final Release
===============================

This package contains the complete deployable release of the Dhamet web application for Cloudflare.
It is organized as an operational release package.

Package structure
-----------------

site/
  Static frontend for Cloudflare Pages. This directory contains the public application files:
  HTML pages, CSS, JavaScript, icons, images, robots.txt, sitemap.xml, and HTTP headers.

worker/
  Cloudflare Worker/API runtime. This directory contains the Worker entrypoint, API routes,
  Durable Object runtime, D1 migrations, and Worker configuration.

shared/
  Single shared runtime source used by both the frontend and the Worker. Deployment scripts copy
  this directory into a prepared Pages package and a prepared Worker package before publishing.

deploy/
  Deployment scripts. These scripts prepare and deploy only the approved runtime files needed by
  each Cloudflare target.

.github/workflows/
  GitHub Actions workflows for deploying the frontend and Worker using the deployment scripts.

package.json
  Minimal deployment command file. It contains deployment commands only.

Deployment requirements
-----------------------

GitHub repository secrets:

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

GitHub repository variables:

- CLOUDFLARE_PAGES_PROJECT_NAME
- CLOUDFLARE_D1_DATABASE_NAME

Cloudflare Worker secrets:

- RESEND_API_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- INTERNAL_API_SECRET

Optional TURN secrets:

- EXPRESS_TURN_SECRET
- EXPRESS_TURN_USERNAME
- EXPRESS_TURN_CREDENTIAL
- EXPRESS_TURN_URLS

Deployment commands
-------------------

Install the deployment dependency:

  npm install --no-audit --no-fund

Deploy the site only:

  npm run deploy:pages

Deploy the Worker/API only:

  npm run deploy:worker

Deploy both:

  npm run deploy

Deployment behavior
-------------------

Pages deployment:

  deploy/deploy-pages.mjs prepares .tmp/deploy-site/ from site/ and shared/, then publishes only
  that prepared directory to Cloudflare Pages.

Worker deployment:

  deploy/deploy-worker.mjs prepares .tmp/deploy-worker/ from worker/ and shared/, applies D1
  migrations when SQL migration files are present, then publishes only the prepared Worker package.

Deployment workflows
--------------------

The repository includes two workflows:

- .github/workflows/deploy-pages.yml
- .github/workflows/deploy-worker.yml

The Pages workflow reacts to changes in site/, shared/, its deployment script, and its workflow file.
The Worker workflow reacts to changes in worker/, shared/, its deployment script, and its workflow file.

Configuration files
-------------------

Worker configuration is in:

  worker/wrangler.toml

Before deploying to a Cloudflare project, verify these values:

- Worker name
- D1 database name and database_id
- APP_ORIGIN
- RESEND_FROM_EMAIL
- Worker route or custom domain settings

Operational notes
-----------------

- The frontend and Worker are separated at source level.
- Shared runtime files exist once in shared/.
- The deployment scripts prepare target-specific publish directories under .tmp/.
- Only operational release files are included in this package.
- The package is intended to be deployed after Cloudflare secrets, variables, domains, and D1 settings are confirmed.

License
-------

This software is proprietary. See LICENSE.txt.


Cloudflare deployment configuration

The package includes deployment defaults in package.json:

- cloudflare.pagesProjectName: dhamet2
- cloudflare.d1DatabaseName: dhamet2_test

GitHub repository variables may override these values:

- CLOUDFLARE_PAGES_PROJECT_NAME
- CLOUDFLARE_D1_DATABASE_NAME

Required GitHub secrets:

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

Before production deployment, confirm that worker/wrangler.toml contains the intended Worker name, D1 database name, D1 database ID, APP_ORIGIN, and mail sender.
