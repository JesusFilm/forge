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

### 3) Set up MFA

1. Change password when prompted.
2. Click your **account name** (top-right corner) -> **Security credentials**.
3. Scroll to **Multi-factor authentication (MFA)** -> **Assign MFA device**.
4. You will see "Access denied" errors in other sections of this page (e.g. access keys, signing certificates). This is normal — most permissions are locked until MFA is active.

### 4) Sign out and sign back in

MFA-gated permissions only take effect after re-authenticating. Sign out, then sign back in — this time you will be prompted for your MFA code. After this, full permissions are active.

### 5) Create access key

1. Click your **account name** (top-right corner) -> **Security credentials**.
2. **Access keys** -> **Create access key** -> **Command Line Interface (CLI)**.
3. On the **Retrieve access keys** step, copy your **Access key** and **Secret access key** (you won't be able to see the secret again).

### 6) Install AWS CLI + configure profile

1. Install the AWS CLI v2 if you don't have it:
   - macOS: `brew install awscli`
   - Other: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
2. Configure profile:
   ```
   aws configure --profile forge-dev-secrets
   ```
   When prompted:
   - **AWS Access Key ID**: paste from step 5
   - **AWS Secret Access Key**: paste from step 5
   - **Default region name**: `us-east-2`
   - **Default output format**: `json`
3. Verify credentials work (should print your ARN and account ID):
   - `aws sts get-caller-identity --profile forge-dev-secrets`
4. Fetch secrets (from repo root):
   - `AWS_PROFILE=forge-dev-secrets pnpm fetch-secrets`

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
