{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [ gnumake gettext glib gnome.gnome-shell zip ];
}
