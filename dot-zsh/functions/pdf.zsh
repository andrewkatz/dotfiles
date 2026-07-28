optimize_pdf() {
  if [ "$#" -ne 1 ]; then
    echo "Usage: optimize_pdf filename.pdf" >&2
    return 2
  fi

  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Error: file not found: $file" >&2
    return 1
  fi
  if ! command -v gs >/dev/null 2>&1; then
    echo "Error: Ghostscript is required (brew install ghostscript)" >&2
    return 1
  fi

  local dir tmp original_size optimized_size
  dir=$(dirname "$file")
  tmp=$(mktemp "$dir/.optimize_pdf.XXXXXX.pdf") || return 1
  original_size=$(wc -c < "$file" | tr -d ' ')

  if ! gs -sDEVICE=pdfwrite \
    -dCompatibilityLevel=1.4 \
    -dPDFSETTINGS=/ebook \
    -dDetectDuplicateImages=true \
    -dCompressFonts=true \
    -dNOPAUSE -dQUIET -dBATCH \
    -sOutputFile="$tmp" -f "$file"; then
    rm -f "$tmp"
    echo "Error: failed to optimize: $file" >&2
    return 1
  fi

  optimized_size=$(wc -c < "$tmp" | tr -d ' ')
  if [ "$optimized_size" -ge "$original_size" ]; then
    rm -f "$tmp"
    echo "Already optimized: $file"
    return 0
  fi

  if ! cp "$tmp" "$file"; then
    rm -f "$tmp"
    echo "Error: failed to replace: $file" >&2
    return 1
  fi
  rm -f "$tmp"
  echo "Optimized: $file ($original_size -> $optimized_size bytes)"
}

small_pdf() {
  optimize_pdf "$@"
}
