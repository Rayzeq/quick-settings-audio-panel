{ pkgs ? import <nixos> { } }:
pkgs.mkShell {
  nativeBuildInputs = with pkgs.buildPackages; [
    glib
  ];
  shellHook = ''
  '';
}
