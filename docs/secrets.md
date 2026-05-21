# Secrets

Machine-specific secrets are kept out of this public repo. The supported flow uses [sops](https://github.com/getsops/sops) with [age](https://github.com/FiloSottile/age):

- Encrypted values live in a separate **private** repo, `andrewkatz/dotfiles-secrets`.
- Plaintext is only produced locally during `sops` edit/decrypt operations.
- Decryption needs only the age private key on each machine, so it works headlessly.

## Layout

```text
~/.config/sops/age/keys.txt          # age private key
~/.config/dotfiles-secrets/          # private secrets repo
├── .sops.yaml                       # sops recipient config
└── secrets.yaml                     # sops-encrypted YAML
~/.config/dotfiles/machine_name      # selected top-level section
~/.zsh_secrets                       # generated exports sourced by zsh
```

`secrets.yaml` has one top-level section per machine, plus `common:` for shared values:

```yaml
common:
  EXAMPLE_SHARED_VALUE: "..."
andrew-mac:
  EXAMPLE_MACHINE_VALUE: "..."
```

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
   git clone git@github.com:andrewkatz/dotfiles-secrets.git ~/.config/dotfiles-secrets
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
   sops --decrypt ~/.config/dotfiles-secrets/secrets.yaml
   git -C ~/.config/dotfiles-secrets add .sops.yaml secrets.yaml
   git -C ~/.config/dotfiles-secrets commit -m "Migrate secrets"
   git -C ~/.config/dotfiles-secrets push
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
sops ~/.config/dotfiles-secrets/secrets.yaml
```

Refresh `~/.zsh_secrets`:

```bash
bin/ss
```
