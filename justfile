@_list:
    just --list {{justfile()}}

build-container:
    podman build . -t zola

serve:
    podman run --rm -it --userns keep-id -v .:/var/www:z --network host zola serve
