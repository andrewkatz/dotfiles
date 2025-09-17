return {
  {
    "w0rp/ale",
    config = function()
      vim.g.ale_linters = {
        eruby = { "erblint" },
        go = { "gofmt" },
        haml = { "hamllint" },
        javascript = { "eslint" },
        lua = { "stylua" },
        php = { "phpcs" },
        rust = { "analyzer", "cargo" },
        swift = { "swiftlint" },
      }
      vim.g.ale_fixers = {
        css = { "stylelint" },
        eruby = { "erblint" },
        gdscript = {
          function(buffer, lines)
            return vim.fn.systemlist("gdformat -", lines)
          end,
        },
        go = { "gofmt" },
        haml = {},
        javascript = { "eslint" },
        lua = { "stylua" },
        python = { "black" },
        ruby = { "rubocop" },
        rust = { "rustfmt" },
        scss = { "stylelint" },
        swift = { "swiftformat" },
        terraform = { "terraform" },
      }

      vim.g.ale_fix_on_save = 1
      vim.g.ale_php_phpcs_standard = "PSR12"
      vim.g.ale_ruby_rubocop_auto_correct_all = 1
      vim.g.ale_virtualtext_cursor = 1
      vim.g.ale_echo_cursor = 0

      -- Rust
      vim.g.ale_rust_rustfmt_options = "--edition 2018"
      vim.g.ale_rust_cargo_use_clippy = 1
      vim.g.ale_rust_cargo_check_tests = 1
      vim.g.ale_rust_cargo_check_examples = 1
    end,
  },
  { "tpope/vim-rails", ft = "ruby" },
  { "tpope/vim-sensible" },
  { "tpope/vim-surround" },
  { "tpope/vim-unimpaired" },
  { "vim-scripts/tComment" },
  { "habamax/vim-godot" },
  { "hashivim/vim-terraform" },
  { "kylef/apiblueprint.vim" },
  { "jph00/swift-apple", ft = "swift" },
}
