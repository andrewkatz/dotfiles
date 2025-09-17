return {
  "janko/vim-test",
  keys = {
    { "<leader>r", ":unlet $HEADLESS <CR> :let $PARALLEL_WORKERS = '0' <CR> :TestNearest<CR>", desc = "Test nearest" },
    { "<leader>R", ":unlet $HEADLESS <CR> :let $PARALLEL_WORKERS = '0' <CR> :TestFile<CR>", desc = "Test file" },
    { "<leader>c", ":let $HEADLESS = '0' <CR> :TestNearest<CR>", desc = "Test file" },
  },
}
