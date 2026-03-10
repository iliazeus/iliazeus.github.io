@_list:
    just --list --justfile {{justfile()}}

[group("podman")]
build-container:
    podman build . -t zola

[group("podman")]
[positional-arguments]
zola *args:
    podman run --rm -it --userns keep-id -v .:/var/www:z --network host zola "$@"

[group("docker")]
build-container-docker:
    docker build . -f Containerfile -t zola

[group("docker")]
[positional-arguments]
zola-docker *args:
    docker run --rm -it --user $(id -u):$(id -g) -v .:/var/www:z --network host zola "$@"
