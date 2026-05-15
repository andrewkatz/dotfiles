sketchybar --add item focus.today e \
           --set      focus.today icon= \
                                  label="" \
                                  icon.padding_left=$BRACKET_LEFT_PADDING \
                                  label.padding_right=$BRACKET_RIGHT_PADDING \
                                  icon.color=0xFFCBA6F7 \
                                  label.color=0xFFCBA6F7 \
                                  update_freq=60 \
                                  script="$PLUGIN_DIR/focus.sh" \
           --add bracket focus '/focus\./' \
           --set         focus ${BACKGROUND_OPTIONS[@]}
