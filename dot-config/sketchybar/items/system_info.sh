sketchybar --add item system_info.clock right \
           --set      system_info.clock icon= \
                                        update_freq=10 \
                                        script="$PLUGIN_DIR/clock.sh" \
           --add item system_info.volume right \
           --set      system_info.volume script="$PLUGIN_DIR/volume.sh" \
           --add event microphone_status_change \
           --subscribe system_info.volume volume_change microphone_status_change \
           --add item system_info.battery right \
           --set      system_info.battery update_freq=120 \
                                          script="$PLUGIN_DIR/battery.sh" \
           --subscribe system_info.battery system_woke power_source_change \
           --add bracket system_info '/system_info\./' \
           --set         system_info ${BACKGROUND_OPTIONS[@]}
