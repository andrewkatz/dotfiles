function wmm() {
  gh pr merge --admin &&
    wt remove -D &&
    git pull
}
