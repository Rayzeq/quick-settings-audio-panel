{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [
    glib
    nodejs
  ];
  shellHook = ''
  '';
}
