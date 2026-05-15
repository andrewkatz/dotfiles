sketchybar --add event aerospace_workspace_change \
           --add event aerospace_window_moved

space_commands=()
for sid in $(aerospace list-workspaces --all); do
  space_commands+=(--add item space.$sid left \
             --set space.$sid \
             label="$sid" \
             background.height=$BACKGROUND_HEIGHT \
             padding_left=0 \
             padding_right=0 \
             label.padding_left=10 \
             label.padding_right=10 \
             background.corner_radius=$BACKGROUND_CORNER_RADIUS \
             icon.drawing=off \
             click_script="aerospace workspace $sid")
done
sketchybar "${space_commands[@]}"

sketchybar --add bracket aerospace '/space\./' \
           --subscribe   aerospace aerospace_workspace_change aerospace_window_moved \
           --set         aerospace ${BACKGROUND_OPTIONS[@]} \
                                   script="$PLUGIN_DIR/aerospace.sh"

