# Quick dir jumpers (compdef requires compinit to have run first;
# dot-zshrc sources this AFTER compinit for that reason).
d() {
  cd ~/Work/$1
}
compdef "_files -W \"$HOME/Work\"" d

tmp() {
  cd ~/tmp/$1
}
compdef "_files -W \"$HOME/tmp\"" tmp

nvimrc() {
  previous_dir=$(pwd)
  cd ~/.config/nvim
  nvim
  cd $previous_dir
}

pcurl() {
  curl -s $1 | underscore print --outfmt pretty
}

convert_wav() {
  lame -b 320 -h $1.wav $1.mp3
  rm -rf $1.wav
}
