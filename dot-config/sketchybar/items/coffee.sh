sketchybar --add event        coffee_changed \
           --add item  coffee left \
           --subscribe coffee coffee_changed \
           --set       coffee icon=󰛊 \
                              padding_left=0 \
                              icon.padding_left=0 \
                              icon.padding_right=4 \
                              label.drawing=off \
                              update_freq=5 \
                              script="$PLUGIN_DIR/coffee.sh" \
                              click_script="$SCRIPT_DIR/toggle-caffeinate.sh"
