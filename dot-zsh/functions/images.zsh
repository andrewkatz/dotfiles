round_image() {
  extension=${1##*.}
  rounded_filename=$(echo $1 | sed 's/\.[^.]*$//')_round.$extension
  width=$(identify -format "%w" $1)
  radius=$(expr $width / 2 - 1)

  magick -size "${width}x${width}" xc:none -draw "circle $radius.5,$radius.5 $radius.5,0" mask.png
  magick $1 -alpha Set mask.png -compose DstIn -composite $rounded_filename
  rm mask.png
}

optimize_image() {
  if [ -z "$TINIFY_API_KEY" ]; then
    echo "Error: TINIFY_API_KEY not set (export it in ~/.zsh_secrets)"
    return 1
  fi
  echo "Processing: $1"
  optimized_url=$(curl -s --user "api:$TINIFY_API_KEY" --data-binary @"$1" https://api.tinify.com/shrink | jq -r '.output.url')
  curl -s "$optimized_url" --output "$1"
  echo "Optimized: $1"
}

optimize_images() {
  extensions=("jpg" "jpeg" "png")

  for ext in "${extensions[@]}"
  do
    if ls *.$ext 1> /dev/null 2>&1; then
      for f in *.$ext
      do
        optimize_image "$f"
      done
    else
      echo "No .$ext files found"
    fi
  done
}

optimize_all_images() {
  start_dir=$(pwd)

  for dir in */
  do
    if [ -d "$dir" ]; then
      echo "Entering directory: $dir"
      cd "$dir"
      optimize_images
      cd "$start_dir"
      echo "Finished processing: $dir"
    fi
  done

  echo "Processing current directory"
  optimize_images
}
