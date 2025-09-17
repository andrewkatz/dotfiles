vim.g.mapleader = ";"

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  { import = "plugins" },
})

-- Misc
vim.opt.backspace = "indent,eol,start"
vim.opt.colorcolumn = "120"
vim.opt.expandtab = true
vim.opt.mouse = "a"
vim.opt.re = 1
vim.opt.ruler = true
vim.opt.shiftwidth = 2
vim.opt.smartindent = true
vim.opt.tabstop = 2
vim.opt.ttyfast = true
vim.opt.wrap = false

-- Improved movement through wrapped lines
vim.api.nvim_set_keymap("n", "j", "gj", { noremap = true })
vim.api.nvim_set_keymap("n", "k", "gk", { noremap = true })

-- Search stuff
vim.opt.hlsearch = true
vim.opt.ignorecase = true
vim.opt.incsearch = true
vim.opt.smartcase = true
vim.api.nvim_set_keymap("n", "/", "/\\v", { noremap = true })
vim.api.nvim_set_keymap("v", "/", "/\\v", { noremap = true })
vim.api.nvim_set_keymap("n", "<leader>q", ":nohlsearch<CR>", { noremap = true })

-- Use system clipboard
vim.opt.clipboard:append("unnamedplus")

-- Highligh cursor line number
vim.opt.cursorline = true

-- Relative numbers
vim.opt.nu = true
vim.opt.rnu = true

-- Always display the status line
vim.opt.laststatus = 2

-- Tabs
vim.api.nvim_set_keymap("n", "<leader>1", "1gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>2", "2gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>3", "3gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>4", "4gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>5", "5gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>6", "6gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>7", "7gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>8", "8gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>9", "9gt", { noremap = true, silent = true })
vim.api.nvim_set_keymap("n", "<leader>0", "10gt", { noremap = true, silent = true })

-- Cursor
-- vim.o.guicursor =
--   "n-v-c:hor20,i-ci-ve:ver25,r-cr:hor20,o:hor50,a:blinkwait700-blinkoff400-blinkon250-Cursor/lCursor,sm:block-blinkwait175-blinkoff150-blinkon175"
-- vim.cmd([[au VimLeave * set guicursor=a:hor20-blinkon0]])

-- Trailing characters
vim.opt.list = true
vim.opt.listchars:append({ tab = "»·", trail = "·" })

-- Respace
vim.cmd([[command! Respace %s/\(\s\+\)\(\n\)/\2/]])

-- Globally ignore files and directories
vim.o.wildignore = vim.o.wildignore .. "**/log/**,*.orig,*.swp,*.rbc,*.pyc"

-- Set swap directory
vim.o.dir = "~/.vim/swap//,/var/tmp//,/tmp//,."

-- PHP
vim.cmd([[au FileType php set tabstop=4 shiftwidth=4]])
vim.g.phpfmt_standard = "PSR2"

-- Gdscript
vim.cmd([[au FileType gdscript setlocal tabstop=4 shiftwidth=4 noexpandtab]])

-- Auto save on focus lost
vim.cmd("autocmd BufLeave,FocusLost * silent! wall")
