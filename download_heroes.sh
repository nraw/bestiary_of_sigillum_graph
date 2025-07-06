#\!/bin/bash

# Base URL for the images
BASE_URL="https://www.bestiary.online"

# Array of image paths
images=(
    "/file/2_1_architectus.png"
    "/file/3_2_armus.png"
    "/file/4_3_caballus.png"
    "/file/11_10_aqus.png"
    "/file/12_11_ballistarius.png"
    "/file/13_12_cerberus.png"
    "/file/20_19_arborus.png"
    "/file/21_20_fidea.png"
    "/file/22_21_frigus.png"
    "/file/5_4_carnifex.png"
    "/file/6_5_catapultus.png"
    "/file/7_6_ferrarius.png"
    "/file/14_13_cornibus.png"
    "/file/15_14_iratus.png"
    "/file/16_15_mortum.png"
    "/file/23_22_goetium.png"
    "/file/24_23_ignifer.png"
    "/file/25_24_illesebra.png"
    "/file/8_7_malleus.png"
    "/file/9_8_saxum.png"
    "/file/10_9_vinсtum.png"
    "/file/17_16_redux.png"
    "/file/18_17_tempus.png"
    "/file/19_18_toxicum.png"
    "/file/26_25_lignum.png"
    "/file/27_26_manus.png"
    "/file/28_27_messum.png"
    "/file/191_brewus.png"
    "/file/197_mechanicus.png"
    "/file/198_saturn.png"
    "/file/193_equita.png"
    "/file/194_eresida.png"
    "/file/199_tenebris.png"
    "/file/192_camoris.png"
    "/file/195_librorumminiature.png"
    "/file/196_magnus.png"
)

# Download each image
for img in "${images[@]}"; do
    filename=$(basename "$img")
    echo "Downloading $filename..."
    curl -L -o "hero_images/$filename" "$BASE_URL$img"
    sleep 0.5  # Small delay to be respectful to the server
done

echo "Downloaded ${#images[@]} hero images to hero_images/ directory"
EOF < /dev/null