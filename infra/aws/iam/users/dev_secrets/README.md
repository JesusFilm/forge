# Dev Secrets Onboarding

This is for new developers who need local AWS-backed dev secrets.

Your IAM username format is:

- `<github-handle>-dev-secrets`

This access is managed by Terraform via PRs (no manual Terraform runs).

## For Developers

### 1) Add your GitHub handle

1. Edit `infra/aws/iam/users/dev_secrets/main.tf`.
2. Add your GitHub handle to `local.dev_secret_contributors`:
   - lowercase
   - no `@`
3. Open PR.
4. Merge PR to `main`.
5. Wait for the `aws-prod` job to successfully apply from `main`, which creates your IAM user.
6. Let an admin know your account now needs console sign-in setup.

### 2) Sign in (IAM user, not root)

1. Go to `https://aws.amazon.com/`.
2. Click **Sign in to Console**.
3. Choose **IAM user**.
4. Account ID or alias: `jesus-film-project-ai`.
5. Username: `<github-handle>-dev-secrets`.
6. Password: temporary password from admin.

### 3) Finish account setup

1. Change password when prompted.
2. Go to **IAM** -> **Users** -> your user -> **Security credentials**.
3. Set up MFA:
   - **Multi-factor authentication (MFA)** -> **Assign MFA device**.
4. Create access key:
   - **Access keys** -> **Create access key** -> **Command Line Interface (CLI)**.

### 4) Configure local CLI + fetch secrets

1. Configure profile:
   - `aws configure --profile forge-dev-secrets`
2. Verify:
   - `aws sts get-caller-identity --profile forge-dev-secrets`
3. Fetch secrets:
   - `cd apps/cms && AWS_PROFILE=forge-dev-secrets pnpm fetch-secrets`
   - `cd apps/web && AWS_PROFILE=forge-dev-secrets pnpm fetch-secrets`

## For Admins

After the PR is merged and the `aws-prod` job successfully applies:

1. Go to **IAM** -> **Users** -> `<github-handle>-dev-secrets`.
2. Open **Security credentials**.
3. Under **Console sign-in**, click **Enable** or **Manage**.
4. Set temporary password and require password reset.
5. Send developer:
   - use `https://aws.amazon.com/` -> **Sign in to Console** -> **IAM user**
   - account alias `jesus-film-project-ai`
   - username `<github-handle>-dev-secrets`
   - temporary password
6. Remind them: IAM user only, never root.
