using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlantationSpawner : MonoBehaviour
{
    public GameObject childSlotPrefab;

    private void Start()
    {
        Collider2D[] childrens = gameObject.GetComponentsInChildren<Collider2D>();
        foreach(Collider2D children in childrens) {
            Instantiate(childSlotPrefab, children.transform);
        }
    }
}
