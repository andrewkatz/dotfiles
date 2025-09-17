return {
  {
    "supermaven-inc/supermaven-nvim",
    config = function()
      require("supermaven-nvim").setup({})
    end,
  },
  -- {
  --   "azorng/goose.nvim",
  --   config = function()
  --     require("goose").setup({})
  --   end,
  --   dependencies = {
  --     "nvim-lua/plenary.nvim",
  --     {
  --       "MeanderingProgrammer/render-markdown.nvim",
  --       opts = {
  --         anti_conceal = { enabled = false },
  --       },
  --     },
  --   },
  -- },
}
