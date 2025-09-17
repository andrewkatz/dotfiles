return {
  "folke/which-key.nvim",
  dependencies = { "echasnovski/mini.icons", version = false },
  event = "VeryLazy",
  opts = {
    preset = "helix",
  },
  config = function(_, opts)
    local wk = require("which-key")
    wk.setup(opts)
    wk.add({
      mode = { "n", "v" },
      { "g", group = "goto" },
      { "s", group = "surround" },
      { "z", group = "fold" },
      { "]", group = "next" },
      { "[", group = "prev" },
      { "<leader><tab>", group = "tabs" },
      { "<leader>b", group = "buffer" },
      { "<leader>c", group = "code" },
      { "<leader>f", group = "file/find" },
      { "<leader>g", group = "git" },
      { "<leader>gh", group = "hunks" },
      { "<leader>q", group = "quit/session" },
      { "<leader>s", group = "search" },
      { "<leader>u", group = "ui" },
      { "<leader>w", group = "windows" },
      { "<leader>x", group = "diagnostics/quickfix" },
      { "<leader>t", group = "test" },
    })
  end,
}
