sketchybar --add item calendar.today left \
           --set      calendar.today icon= \
                                    label="" \
                                    icon.padding_left=$BRACKET_LEFT_PADDING \
                                    label.padding_right=$BRACKET_RIGHT_PADDING \
                                    icon.color=0xFFfab387 \
                                    label.color=0xFFfab387 \
                                    update_freq=300 \
                                    script="$PLUGIN_DIR/calendar.sh" \
           --add bracket calendar '/calendar\./' \
           --set         calendar ${BACKGROUND_OPTIONS[@]}
