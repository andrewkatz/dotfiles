sketchybar --add item project_time.today left \
           --set      project_time.today icon=󰃰 \
                                         label="0h0m" \
                                         icon.padding_left=$BRACKET_LEFT_PADDING \
                                         label.padding_right=$BRACKET_RIGHT_PADDING \
                                         update_freq=300 \
                                         script="$PLUGIN_DIR/project_time.sh" \
                                         click_script="sketchybar --set project_time.today popup.drawing=toggle" \
           --add bracket project_time '/project_time\./' \
           --set         project_time ${BACKGROUND_OPTIONS[@]}
