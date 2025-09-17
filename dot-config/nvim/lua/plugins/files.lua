return {
  {
    "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim"
    },
    keys = {
      { "<leader>n", "<cmd>Neotree toggle<cr>", desc = "Toggle file tree" },
      { "<C-G>", "<cmd>Neotree reveal<cr>", desc = "Open file tree to current file" },
    },
  },
  {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.5",
    dependencies = { "nvim-lua/plenary.nvim" },
    keys = {
      { "<leader>t", "<cmd>Telescope find_files<cr>", desc = "Find files" },
      { "<leader>g", "<cmd>Telescope live_grep<cr>", desc = "Live grep" },
      { "<leader>b", "<cmd>Telescope buffers<cr>", desc = "Show buffers" },
      {
        "<leader>#",
        "<cmd>Telescope grep_string<cr>",
        desc = "Grep (word under cursor)",
      },
    },
  },
}
