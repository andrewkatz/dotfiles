# Secrets

Machine-specific secrets are kept out of this public repo. The supported flow uses [sops](https://github.com/getsops/sops) with [age](https://github.com/FiloSottile/age):

- Encrypted values live in a separate **private** repo, `andrewkatz/dotfiles-secrets`.
- Plaintext is only produced locally during `sops` edit/decrypt operations.
- Decryption needs only the age private key on each machine, so it works headlessly.

## Layout

```text
~/.config/sops/age/keys.txt          # age private key
~/Work/dotfiles-secrets/             # private secrets repo
├── .sops.yaml                       # sops recipient config
└── secrets.yaml                     # sops-encrypted YAML
~/.config/dotfiles/machine_name      # selected top-level section
~/.zsh_secrets                       # generated exports sourced by zsh
~/.aws/config                        # optional generated secret file
~/.aws/credentials                   # optional generated secret file
~/.ssh/*                             # optional generated secret files
```

`secrets.yaml` has one top-level section per machine, plus `common:` for shared values.
Scalar values become exports in `~/.zsh_secrets`; entries under `files:` are written to files under `$HOME` with the requested mode:

```yaml
common:
  EXAMPLE_SHARED_VALUE: "..."
  files:
    - path: .aws/config
      mode: "600"
      content: |
        [default]
        region = us-east-1
andrew-mac:
  EXAMPLE_MACHINE_VALUE: "..."
  files:
    - path: .ssh/id_ed25519
      mode: "600"
      content: |
        -----BEGIN OPENSSH PRIVATE KEY-----
        ...
        -----END OPENSSH PRIVATE KEY-----
```

`path` may be relative to `$HOME`, `~/...`, or `$HOME/...`; `bin/ss` refuses parent traversal and paths outside `$HOME`.

Common values used by these dotfiles include:

```yaml
common:
  # Grafana Claude skill
  GRAFANA_URL: "https://grafana.example.com"
  GRAFANA_TOKEN: "glsa_..."

  # Work SSH helper aliases in dot-zsh/aliases.zsh
  WORK_SSH_KEY: "$HOME/.ssh/work/id_ed25519"
  WORK_SSH_CORE_TARGET: "user@host.example.com"
  WORK_SSH_LG_API_TARGET: "user@host.example.com"
  WORK_SSH_WHITELABEL_TARGET: "user@host.example.com"
  WORK_SSH_DATA_TUNNEL_TARGET: "user@host.example.com"
  WORK_SSH_SFTP_TARGET: "user@host.example.com"
```

## AWS files

Prefer AWS IAM Identity Center/SSO where possible. SSO profile configuration can be generated from `files:` without storing long-lived access keys:

```yaml
common:
  files:
    - path: .aws/config
      mode: "600"
      content: |
        [default]
        sso_session = main
        sso_account_id = 123456789012
        sso_role_name = AdministratorAccess
        region = us-east-1
        output = json

        [sso-session main]
        sso_start_url = https://example.awsapps.com/start
        sso_region = us-east-1
        sso_registration_scopes = sso:account:access
```

If static keys are unavoidable, put only `~/.aws/credentials` in secrets:

```yaml
common:
  files:
    - path: .aws/credentials
      mode: "600"
      content: |
        [default]
        aws_access_key_id = AKIA...
        aws_secret_access_key = ...
```

## SSH keys

Public SSH config and public keys may live in the public dotfiles repo if you are comfortable exposing hostnames/usernames. Private keys belong in `dotfiles-secrets`:

```yaml
common:
  files:
    - path: .ssh/id_ed25519
      mode: "600"
      content: |
        -----BEGIN OPENSSH PRIVATE KEY-----
        ...
        -----END OPENSSH PRIVATE KEY-----
    - path: .ssh/id_ed25519.pub
      mode: "644"
      content: |
        ssh-ed25519 AAAA... andrew@example
    - path: .ssh/config
      mode: "600"
      content: |
        Host github.com
          HostName github.com
          User git
          IdentityFile ~/.ssh/id_ed25519
          AddKeysToAgent yes
```

On a new machine, seed the age key first, run `bin/install`/`bin/ss`, then verify with `ssh -T git@github.com` and `aws sts get-caller-identity`.

## First-time setup

1. Generate an age key:

   ```bash
   mkdir -p ~/.config/sops/age
   age-keygen -o ~/.config/sops/age/keys.txt
   chmod 600 ~/.config/sops/age/keys.txt
   age-keygen -y ~/.config/sops/age/keys.txt
   ```

2. Create the private repo `andrewkatz/dotfiles-secrets` on GitHub.

3. Clone it locally:

   ```bash
   git clone git@github.com:andrewkatz/dotfiles-secrets.git ~/Work/dotfiles-secrets
   ```

4. Add `.sops.yaml` to the private repo. Replace `age1...` with the public key from step 1:

   ```yaml
   creation_rules:
     - path_regex: secrets\.yaml$
       age: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

5. Optionally migrate a 1Password item into encrypted YAML:

   ```bash
   OP_ACCOUNT=example.1password.com ~/Work/dotfiles/bin/migrate-from-1password
   ```

6. Inspect, commit, and push the encrypted file in the private repo:

   ```bash
   sops --decrypt ~/Work/dotfiles-secrets/secrets.yaml
   git -C ~/Work/dotfiles-secrets add .sops.yaml secrets.yaml
   git -C ~/Work/dotfiles-secrets commit -m "Migrate secrets"
   git -C ~/Work/dotfiles-secrets push
   ```

7. Generate `~/.zsh_secrets`:

   ```bash
   ~/Work/dotfiles/bin/ss
   ```

## Bootstrapping a new machine

1. Clone dotfiles.
2. Seed the age key from a known-good machine:

   ```bash
   mkdir -p ~/.config/sops/age
   scp known-good:~/.config/sops/age/keys.txt ~/.config/sops/age/keys.txt
   chmod 600 ~/.config/sops/age/keys.txt
   ```

3. Run `bin/install`.

If the age key is missing, install prints instructions and continues without secrets. Re-run `bin/ss` after seeding the key.

## Day-to-day

Edit secrets:

```bash
sops ~/Work/dotfiles-secrets/secrets.yaml
```

Refresh `~/.zsh_secrets`:

```bash
bin/ss
```
