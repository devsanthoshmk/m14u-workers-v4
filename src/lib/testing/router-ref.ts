import type { NavigateFunction, Location } from 'react-router-dom';

let _navigate: NavigateFunction | null = null;
let _location: Location | null = null;

export const routerRef = {
  set(nav: NavigateFunction, loc: Location) {
    _navigate = nav;
    _location = loc;
  },
  get navigate() { return _navigate; },
  get location() { return _location; },
};
