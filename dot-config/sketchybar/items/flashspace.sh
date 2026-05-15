sketchybar --add event flashspace_workspace_change

FLASHSPACE_CLI="/Applications/FlashSpace.app/Contents/Resources/flashspace"

space_commands=()
mapfile -t WORKSPACES < <("$FLASHSPACE_CLI" list-workspaces)

for workspace in "${WORKSPACES[@]}"; do
  # sketchybar item names can't contain spaces; underscore them
  sid=$(echo "$workspace" | tr ' ' '_')
  space_commands+=(--add item space.$sid left \
             --set space.$sid \
             label="$workspace" \
             background.height=$BACKGROUND_HEIGHT \
             padding_left=0 \
             padding_right=0 \
             label.padding_left=10 \
             label.padding_right=10 \
             background.corner_radius=$BACKGROUND_CORNER_RADIUS \
             icon.drawing=off \
             click_script="\"$FLASHSPACE_CLI\" workspace \"$workspace\"")
done
sketchybar "${space_commands[@]}"

sketchybar --add bracket flashspace '/space\..*/' \
           --subscribe   flashspace flashspace_workspace_change \
           --set         flashspace ${BACKGROUND_OPTIONS[@]} \
                                   script="$PLUGIN_DIR/flashspace.sh"
